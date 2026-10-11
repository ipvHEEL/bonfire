import { GtcrnWorkletNode, loadGtcrn, loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url'
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import type { AudioCaptureOptions, AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

// standard — шумоподавление браузера,
// enhanced — нейросеть GTCRN: лучший баланс, речь почти не искажается,
// max — GTCRN и затем RNNoise: шума меньше всего, но голос звучит «обработаннее»
export type NoiseMode = 'standard' | 'enhanced' | 'max'

export const NOISE_MODES: { mode: NoiseMode, label: string, hint: string }[] = [
    { mode: 'standard', label: 'Обычное', hint: 'Встроенное в браузер: для тихой обстановки и слабых устройств' },
    { mode: 'enhanced', label: 'Усиленное', hint: 'Убирает клавиатуру, фоновые голоса и шум улицы' },
    { mode: 'max', label: 'Максимум', hint: 'Для очень шумного места. Голос может звучать немного обработанным' },
]

type Model = 'gtcrn' | 'rnnoise'

const MODELS_FOR_MODE: Record<NoiseMode, Model[]> = {
    standard: [],
    enhanced: ['gtcrn'],
    max: ['gtcrn', 'rnnoise'],
}

const MODE_KEY = 'bonfire:noise-suppression'

// Нейросети работают в AudioWorklet — отдельном аудиопотоке браузера
export const isEnhancedSupported = typeof AudioWorkletNode !== 'undefined'

export function loadNoiseMode(): NoiseMode {
    try {
        const saved = localStorage.getItem(MODE_KEY)
        if (saved === 'standard' || saved === 'enhanced' || saved === 'max') return saved
    } catch {
        // localStorage может быть недоступен (приватный режим)
    }
    return isEnhancedSupported ? 'enhanced' : 'standard'
}

export function saveNoiseMode(mode: NoiseMode) {
    try {
        localStorage.setItem(MODE_KEY, mode)
    } catch {
        // выбор просто не запомнится
    }
}

export function usesProcessor(mode: NoiseMode) {
    return MODELS_FOR_MODE[mode].length > 0
}

// Настройки микрофона для режима. Два шумоподавителя подряд (браузер + нейросеть)
// дают «булькающий» звук и съедают тихую речь, поэтому при нейросети браузерный
// выключаем. voiceIsolation важнее noiseSuppression — его тоже выключаем
export function captureOptions(mode: NoiseMode): AudioCaptureOptions {
    const browserSuppression = !usesProcessor(mode)
    return {
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: browserSuppression,
        voiceIsolation: browserSuppression,
    }
}

// Модели весят ~150–200 КБ: скачиваем каждую один раз за сеанс
const wasmCache: Partial<Record<Model, Promise<ArrayBuffer>>> = {}

function loadModel(model: Model) {
    wasmCache[model] ??= model === 'gtcrn'
        ? loadGtcrn({ url: gtcrnWasmUrl })
        : loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl })
    return wasmCache[model]
}

function createNode(context: AudioContext, model: Model, wasmBinary: ArrayBuffer) {
    return model === 'gtcrn'
        ? new GtcrnWorkletNode(context, { maxChannels: 1, wasmBinary })
        : new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary })
}

// AudioContext, созданный без нажатия пользователя, может остаться на паузе,
// и тогда в звонок уйдёт тишина. Ждём запуска недолго, иначе — ошибка
async function resumeOrFail(context: AudioContext) {
    if (context.state === 'running') return
    await Promise.race([
        context.resume(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AudioContext не запустился')), 1500)),
    ])
    // TypeScript не знает, что resume() меняет state, поэтому приводим тип
    if ((context.state as AudioContextState) !== 'running') throw new Error('AudioContext не запустился')
}

/**
 * Процессор дорожки LiveKit: пропускает звук микрофона через нейросети
 * шумоподавления и отдаёт в звонок уже очищенную дорожку.
 */
export class NoiseSuppressionProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
    name: string
    processedTrack?: MediaStreamTrack

    private models: Model[]
    private context?: AudioContext
    private source?: MediaStreamAudioSourceNode
    private nodes: (GtcrnWorkletNode | RnnoiseWorkletNode)[] = []

    constructor(mode: NoiseMode) {
        this.name = `noise-${mode}`
        this.models = MODELS_FOR_MODE[mode]
    }

    async init({ track }: AudioProcessorOptions) {
        // Обе модели рассчитаны на 48 кГц — это и стандарт WebRTC
        const context = new AudioContext({ sampleRate: 48000 })
        this.context = context
        try {
            const binaries = await Promise.all(this.models.map(loadModel))
            await Promise.all(this.models.map((model) =>
                context.audioWorklet.addModule(model === 'gtcrn' ? gtcrnWorkletUrl : rnnoiseWorkletUrl)
            ))
            await resumeOrFail(context)

            this.source = context.createMediaStreamSource(new MediaStream([track]))
            this.nodes = this.models.map((model, i) => createNode(context, model, binaries[i]))
            const destination = context.createMediaStreamDestination()

            let last: AudioNode = this.source
            for (const node of this.nodes) last = last.connect(node)
            last.connect(destination)
            this.processedTrack = destination.stream.getAudioTracks()[0]
        } catch (error) {
            // Не получилось скачать модель — в следующий раз попробуем снова
            for (const model of this.models) delete wasmCache[model]
            await this.destroy()
            throw error
        }
    }

    async restart(options: AudioProcessorOptions) {
        await this.destroy()
        await this.init(options)
    }

    async destroy() {
        this.source?.disconnect()
        for (const node of this.nodes) {
            node.disconnect()
            node.destroy()
        }
        this.processedTrack?.stop()
        await this.context?.close().catch(() => {})
        this.nodes = []
        this.source = this.context = this.processedTrack = undefined
    }
}

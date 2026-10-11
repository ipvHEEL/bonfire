import time
from collections import defaultdict, deque


class RateLimiter:
    """Счётчик попыток в скользящем окне, в памяти процесса.

    Нужен против перебора паролей и инвайт-кодов. Бэкенд работает в одном
    процессе, поэтому общий счётчик в памяти видит все попытки; после
    перезапуска сервера счётчики обнуляются — это допустимо.
    """

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float):
        hits = self.hits.get(key)
        if hits is None:
            return None
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if not hits:
            del self.hits[key]
            return None
        return hits

    def retry_after(self, key: str):
        """Через сколько секунд снова можно пробовать; 0 — можно сейчас."""
        now = time.monotonic()
        hits = self._prune(key, now)
        if hits is None or len(hits) < self.limit:
            return 0
        return int(hits[0] + self.window - now) + 1

    def hit(self, key: str):
        now = time.monotonic()
        # При переборе с множества адресов ключи копились бы бесконечно:
        # время от времени выметаем все устаревшие
        if len(self.hits) > 10_000:
            for stale in list(self.hits):
                self._prune(stale, now)
        self._prune(key, now)
        self.hits[key].append(now)

    def reset(self, key: str):
        self.hits.pop(key, None)

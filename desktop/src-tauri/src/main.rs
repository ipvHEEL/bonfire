// В релизной сборке не открываем лишнее окно консоли рядом с приложением
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bonfire_desktop_lib::run()
}

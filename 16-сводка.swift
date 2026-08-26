// «Сводка» — настоящее окно со школьной сводкой. Не браузер.
//
// ── Почему не Chrome ──
//
// Сначала пробовали проще: Chrome умеет открывать страницу в режиме
// приложения (ключ --app) — окно без вкладок и адресной строки.
// Не подошло: когда Chrome уже запущен, вторая запускалка не создаёт
// новый браузер, а передаёт адрес открытому — и ключи командной строки
// при этом ВЫБРАСЫВАЮТСЯ. Получается обычная вкладка.
//
// То есть поведение зависит от того, открыт ли у пользователя Chrome. Такое
// в системе держать нельзя: работает через раз — значит не работает.
//
// Здесь окно рисует сама программа (WKWebView — тот же движок, что
// в Safari). Chrome не нужен вовсе, вкладок нет по определению.
//
// ── Сборка ──
//     swiftc -O -o Сводка.app/Contents/MacOS/Сводка 16-сводка.swift
//     codesign --force -s - Сводка.app
// Полностью — см. 02-что-выяснили.md, раздел про отдельное окно.

import Cocoa
import WebKit

// ПУТЬ К ПРОЕКТУ НЕ ЗАШИТ В КОД.
//
// Напоминалка находит папку сама -- она в ней и лежит. Сводка так не может:
// её копия живёт в /Applications, чтобы «Быстрые команды» видели её в списке
// и на неё можно было повесить горячую клавишу.
//
// Поэтому путь вписывается в Info.plist при сборке (см. `собрать.sh`),
// а здесь только читается. В исходнике не остаётся ни чужой домашней папки,
// ни имени пользователя -- проект можно выкладывать как есть.
//
// Три попытки по очереди, от точной к отчаянной.
let папка: String = {
    // 1. То, что вписал сборочный скрипт.
    if let изPlist = Bundle.main.object(forInfoDictionaryKey: "ПутьПроекта") as? String,
       !изPlist.isEmpty,
       FileManager.default.fileExists(atPath: изPlist + "/сводка.html") {
        return изPlist
    }

    // 2. Рядом с самим приложением -- если его не копировали в /Applications.
    let рядом = Bundle.main.bundleURL.deletingLastPathComponent().path
    if FileManager.default.fileExists(atPath: рядом + "/сводка.html") {
        return рядом
    }

    // 3. Не нашли. Возвращаем «рядом» -- окно покажет пустую страницу,
    //    и это честнее, чем открыть чужую сводку по угаданному пути.
    return рядом
}()
let страница = папка + "/сводка.html"

class Делегат: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var окно: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ уведомление: Notification) {
        окно = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1150, height: 850),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        окно.title = "Школьная сводка"
        окно.center()
        // Запоминаем размер и место окна между запусками.
        окно.setFrameAutosaveName("СводкаОкно")

        // ПОЛОСЫ С КНОПКОЙ ЗДЕСЬ НЕТ, И ЭТО НАРОЧНО.
        //
        // Сначала кнопка «Обновить» была именно здесь, отдельной полосой
        // наверху окна. пользователь попросил перенести её на саму страницу
        // и сделать маленькой, как в браузере. Так лучше: в окне не
        // пропадает 38 точек по высоте, а кнопка заодно появляется
        // и во вкладке браузера, если сводку открыть обычным способом.
        //
        // Она там обычная ссылка-кнопка с location.reload() — окну для
        // этого делать ничего не нужно.
        web = WKWebView(frame: окно.contentView!.bounds)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        окно.contentView!.addSubview(web)

        показать()

        окно.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func показать() {
        let адрес = URL(fileURLWithPath: страница)
        // Второй параметр — какую папку разрешено читать. Без него
        // WKWebView не пустит к файлу вообще.
        web.loadFileURL(адрес, allowingReadAccessTo: URL(fileURLWithPath: папка))
    }

    // Сводка перезаписывается каждые десять минут. Когда возвращаешься
    // к окну, оно должно показывать свежее, а не то, что было утром.
    func applicationDidBecomeActive(_ уведомление: Notification) {
        if web != nil { показать() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ приложение: NSApplication) -> Bool {
        return true
    }

    // ССЫЛКИ НАРУЖУ ОТДАЁМ СИСТЕМЕ, А НЕ ОТКРЫВАЕМ ВНУТРИ.
    //
    // Две причины. Задание в Classroom требует школьного аккаунта — он
    // есть в Chrome у пользователя, а в этом окне никакого входа нет вовсе.
    // И кнопки «не срочно» и «скрыть» — это ссылки napominalka://,
    // их обязана поймать Напоминалка, а не окно.
    func webView(_ web: WKWebView,
                 decidePolicyFor действие: WKNavigationAction,
                 decisionHandler решение: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let адрес = действие.request.url else {
            решение(.allow)
            return
        }
        // napominalka:// ловим ПО СХЕМЕ, а не по типу перехода: кнопка
        // «обновить» при долгом нажатии ставит адрес из кода страницы,
        // и тип там не «щёлкнули по ссылке», а «переход по другой причине».
        //
        // Сама сводка (file://) грузится внутри окна, всё прочее — наружу.
        if адрес.scheme == "napominalka" ||
           (действие.navigationType == .linkActivated && !адрес.isFileURL) {
            NSWorkspace.shared.open(адрес)
            решение(.cancel)
            return
        }
        решение(.allow)
    }
}

let приложение = NSApplication.shared
let делегат = Делегат()
приложение.delegate = делегат
приложение.setActivationPolicy(.regular)
приложение.run()

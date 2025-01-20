import Cocoa
import Foundation

class TextSelectionObserver: NSObject {
    let workspace = NSWorkspace.shared
    var lastSelectedText: String?

    override init() {
        super.init()

        // 注册通知观察者
        let observer = NSWorkspace.shared.notificationCenter
        observer.addObserver(
            self,
            selector: #selector(handleSelectionChange),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )

        // 监听选择变化通知
        var axObserver: AXObserver?
        let error = AXObserverCreate(getpid(), { observer, element, notification, userData in
            let selfPointer = userData!.load(as: TextSelectionObserver.self)
            selfPointer.checkSelectedText()
        }, &axObserver)

        if error == .success, let axObserver = axObserver {
            CFRunLoopAddSource(
                RunLoop.main.getCFRunLoop(),
                AXObserverGetRunLoopSource(axObserver),
                .defaultMode
            )

            // 当前活动应用添加监听
            updateActiveAppObserver(axObserver)
        }
    }

    @objc func handleSelectionChange(_ notification: Notification) {
        // 应用切换时更新监听
        var axObserver: AXObserver?
        let error = AXObserverCreate(getpid(), { _, _, _, _ in }, &axObserver)
        if error == .success, let axObserver = axObserver {
            updateActiveAppObserver(axObserver)
        }
    }

    func updateActiveAppObserver(_ axObserver: AXObserver) {
        guard let app = workspace.frontmostApplication else { return }
        let pid = app.processIdentifier
        let element = AXUIElementCreateApplication(pid)

        // 添加选择变化通知监听
        AXObserverAddNotification(
            axObserver,
            element,
            kAXSelectedTextChangedNotification as CFString,
            UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        )
    }

    func checkSelectedText() {
        if let text = getSelectedText() {
            if text.count > 0 && text != lastSelectedText {
                print(text)
                fflush(stdout)
                lastSelectedText = text
            }
        }
    }

    func getSelectedText() -> String? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let pid = app.processIdentifier

        let axApp = AXUIElementCreateApplication(pid)
        var focusedElement: AnyObject?

        // Get focused element
        let result = AXUIElementCopyAttributeValue(axApp, kAXFocusedUIElementAttribute as CFString, &focusedElement)
        guard result == .success else { return nil }

        // Try different approaches to get selected text
        var selectedText: AnyObject?

        // First try: Direct selected text
        var textResult = AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, kAXSelectedTextAttribute as CFString, &selectedText)

        // Second try: Selected text in text area
        if textResult != .success {
            var selectedTextRange: AnyObject?
            textResult = AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, kAXSelectedTextRangeAttribute as CFString, &selectedTextRange)
            if textResult == .success {
                textResult = AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, kAXValueAttribute as CFString, &selectedText)
            }
        }

        // Third try: Get selected text from parent element
        if textResult != .success {
            var parent: AnyObject?
            if AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, kAXParentAttribute as CFString, &parent) == .success {
                textResult = AXUIElementCopyAttributeValue(parent as! AXUIElement, kAXSelectedTextAttribute as CFString, &selectedText)
            }
        }

        guard textResult == .success, let text = selectedText as? String else { return nil }
        return text
    }
}

let observer = TextSelectionObserver()

signal(SIGINT) { _ in
    exit(0)
}

RunLoop.main.run()
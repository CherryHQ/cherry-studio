import AppKit

@MainActor
private final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private var controller: HelperController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = HelperController()
        self.controller = controller
        controller.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller?.prepareForTermination()
    }
}

@MainActor
private func runApplication() {
    let application = NSApplication.shared
    let delegate = ApplicationDelegate()
    application.setActivationPolicy(.accessory)
    application.delegate = delegate
    withExtendedLifetime(delegate) {
        application.run()
    }
}

runApplication()

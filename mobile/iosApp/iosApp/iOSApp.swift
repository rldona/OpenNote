import SwiftUI
import WebKit
import ComposeApp

@main
struct iOSApp: App {
    init() {
        IosHooks.shared.configureEditorWebView = { web in removeKeyboardAccessoryBar(web) }
        // Notifications, background refresh and sync on foreground/background; must run before launch finishes.
        Services_iosKt.startIosServices()
    }

    var body: some Scene {
        WindowGroup {
            ComposeView().ignoresSafeArea(.all)
        }
    }
}

/// The Compose UI (composeApp) hosted in SwiftUI.
struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController { MainViewControllerKt.MainViewController() }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

/// WKWebView puts its own bar (previous / next / done) above the keyboard, under the app's formatting bar, and has no public
/// switch for it. The web view's content view gets a subclass whose `inputAccessoryView` is nil, a long-standing technique
/// of rich-text editors on iOS.
func removeKeyboardAccessoryBar(_ web: WKWebView) {
    guard let content = web.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
    let base: AnyClass = type(of: content)
    let name = "\(base)_OpenNoteNoAccessory"
    var cls: AnyClass? = NSClassFromString(name)
    if cls == nil, let created = objc_allocateClassPair(base, name, 0) {
        let noBar: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
        class_addMethod(created, NSSelectorFromString("inputAccessoryView"), imp_implementationWithBlock(noBar), "@@:")
        objc_registerClassPair(created)
        cls = created
    }
    if let cls { object_setClass(content, cls) }
}

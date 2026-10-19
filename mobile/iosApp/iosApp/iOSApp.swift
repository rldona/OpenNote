import SwiftUI
import ComposeApp

@main
struct iOSApp: App {
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

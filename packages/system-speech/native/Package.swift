// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SystemSpeechHelper",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "cherry-system-speech", targets: ["SystemSpeechHelper"])],
    targets: [
        .executableTarget(name: "SystemSpeechHelper"),
        .testTarget(name: "SystemSpeechHelperTests", dependencies: ["SystemSpeechHelper"]),
    ]
)

// swift-tools-version: 6.2
import Foundation
import PackageDescription

let infoPlist = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Info.plist").path

let package = Package(
    name: "SystemSpeechHelper",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "cherry-system-speech", targets: ["SystemSpeechHelper"])],
    targets: [
        .executableTarget(
            name: "SystemSpeechHelper",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlist,
                ]),
            ]
        ),
        .testTarget(name: "SystemSpeechHelperTests", dependencies: ["SystemSpeechHelper"]),
    ]
)

// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ConversationIslandHelper",
    platforms: [.macOS(.v12)],
    targets: [
        .target(name: "ConversationIslandCore"),
        .testTarget(
            name: "ConversationIslandCoreTests",
            dependencies: ["ConversationIslandCore"],
            resources: [.copy("Fixtures")]
        )
    ]
)

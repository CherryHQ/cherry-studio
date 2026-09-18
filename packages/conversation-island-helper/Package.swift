// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ConversationIslandHelper",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "conversation-island-helper", targets: ["ConversationIslandHelper"])
    ],
    targets: [
        .target(name: "ConversationIslandCore"),
        .executableTarget(
            name: "ConversationIslandHelper",
            dependencies: ["ConversationIslandCore"]
        ),
        .testTarget(
            name: "ConversationIslandCoreTests",
            dependencies: ["ConversationIslandCore"],
            resources: [.copy("Fixtures")]
        ),
        .testTarget(
            name: "ConversationIslandHelperTests",
            dependencies: ["ConversationIslandHelper", "ConversationIslandCore"]
        )
    ]
)

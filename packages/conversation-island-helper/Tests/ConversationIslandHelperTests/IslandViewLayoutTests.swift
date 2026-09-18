import AppKit
import ConversationIslandCore
import SwiftUI
import XCTest
@testable import ConversationIslandHelper

@MainActor
final class IslandViewLayoutTests: XCTestCase {
    func testCompactSurfaceRemainsPinnedToTopWhileHostGrows() throws {
        let model = IslandViewModel()
        let placement = IslandPlacement(
            bounds: IslandRect(x: 0, y: 0, width: 320, height: 38),
            presentation: .capsule,
            notchWidth: nil
        )
        model.apply(
            revision: 1,
            payload: PresentationPayload(
                displayId: 1,
                expanded: false,
                reducedMotion: true,
                theme: PresentationTheme(appearance: .dark, primaryColor: "#00B96B", fontFamily: ""),
                primaryActivityId: "topic-1",
                activityCount: 1,
                activityCountText: "1 activity",
                activities: [
                    PresentationActivity(
                        activityId: "topic-1",
                        identityAvatar: "A",
                        identityName: "Assistant",
                        state: .streaming,
                        statusText: "Working",
                        title: "Test activity"
                    )
                ]
            ),
            placement: placement
        )

        let hostingView = NSHostingView(
            rootView: IslandView(viewModel: model, onHoverChanged: { _, _ in }, onOpenActivity: { _, _ in })
        )
        hostingView.frame = NSRect(x: 0, y: 0, width: 370, height: 60)
        hostingView.layoutSubtreeIfNeeded()

        let bitmap = try XCTUnwrap(hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds))
        hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)

        let topPixelY = bitmap.pixelsHigh - 1
        let hasOpaquePixelAtTop = (0..<bitmap.pixelsWide).contains { x in
            (bitmap.colorAt(x: x, y: topPixelY)?.alphaComponent ?? 0) > 0.9
        }
        XCTAssertTrue(hasOpaquePixelAtTop, "The island surface must remain attached to the host's top edge during resize")
    }
}

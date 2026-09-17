import XCTest
@testable import ConversationIslandCore

final class GeometryTests: XCTestCase {
    func testCompactSizeUsesMinimumWidthForA120PointNotch() {
        XCTAssertEqual(
            IslandGeometry.placement(on: screen(notchWidth: 120), size: IslandGeometry.compactSize),
            IslandPlacement(
                bounds: IslandRect(x: 420, y: 682, width: 280, height: 38),
                presentation: .notch,
                notchWidth: 120
            )
        )
    }

    func testCompactSizeIncludesSideContentForA185PointNotch() {
        XCTAssertEqual(
            IslandGeometry.placement(on: screen(notchWidth: 185), size: IslandGeometry.compactSize),
            IslandPlacement(
                bounds: IslandRect(x: 387.5, y: 682, width: 345, height: 38),
                presentation: .notch,
                notchWidth: 185
            )
        )
    }

    func testExpandedNotchPlacementKeepsTheRequestedWidth() {
        let size = IslandGeometry.expandedSize(activityCount: 5)

        XCTAssertEqual(
            IslandGeometry.placement(on: screen(notchWidth: 120), size: size),
            IslandPlacement(
                bounds: IslandRect(x: 350, y: 474, width: 420, height: 246),
                presentation: .notch,
                notchWidth: 120
            )
        )
    }

    func testFallbackUsesAppKitTopEdgeAndEightPointOffset() {
        let external = screen(notchWidth: 120, safeAreaTop: 0)

        XCTAssertEqual(
            IslandGeometry.placement(on: external, size: IslandGeometry.compactSize),
            IslandPlacement(
                bounds: IslandRect(x: 400, y: 674, width: 320, height: 38),
                presentation: .capsule,
                notchWidth: nil
            )
        )
    }

    func testPlacementSupportsNegativeMultiDisplayCoordinatesWithoutDisplayIdentity() {
        let external = ScreenGeometry(
            frame: IslandRect(x: -1600, y: -200, width: 1000, height: 700),
            safeAreaInsets: IslandInsets(top: 0, left: 0, bottom: 0, right: 0),
            auxiliaryTopLeftArea: .zero,
            auxiliaryTopRightArea: .zero
        )

        XCTAssertEqual(
            IslandGeometry.placement(on: external, size: IslandGeometry.compactSize).bounds,
            IslandRect(x: -1260, y: 454, width: 320, height: 38)
        )
    }

    func testImplausibleNotchGeometryFallsBackToCapsule() {
        let invalidScreens = [
            screen(notchWidth: 300),
            screen(notchWidth: 120, centerOffset: 150),
            screen(notchWidth: 120, topOffset: 3)
        ]

        for invalidScreen in invalidScreens {
            XCTAssertEqual(
                IslandGeometry.placement(on: invalidScreen, size: IslandGeometry.compactSize).presentation,
                .capsule
            )
        }
    }

    func testExpandedSizeCapsVisibleRowsAtFourWhileRetainingExpectedSingleHeight() {
        let expectations: [(Int, IslandSize)] = [
            (1, IslandSize(width: 420, height: 82)),
            (2, IslandSize(width: 420, height: 142)),
            (3, IslandSize(width: 420, height: 194)),
            (4, IslandSize(width: 420, height: 246)),
            (5, IslandSize(width: 420, height: 246)),
            (8, IslandSize(width: 420, height: 246))
        ]

        for (activityCount, expected) in expectations {
            XCTAssertEqual(IslandGeometry.expandedSize(activityCount: activityCount), expected)
        }
    }

    private func screen(
        notchWidth: Double,
        centerOffset: Double = 0,
        topOffset: Double = 0,
        safeAreaTop: Double = 32
    ) -> ScreenGeometry {
        let frame = IslandRect(x: 0, y: 0, width: 1120, height: 720)
        let gapCenter = frame.midX + centerOffset
        let gapStart = gapCenter - notchWidth / 2
        let auxiliaryHeight = 32.0
        let auxiliaryY = frame.maxY - auxiliaryHeight - topOffset

        return ScreenGeometry(
            frame: frame,
            safeAreaInsets: IslandInsets(top: safeAreaTop, left: 0, bottom: 0, right: 0),
            auxiliaryTopLeftArea: IslandRect(
                x: frame.minX,
                y: auxiliaryY,
                width: gapStart - frame.minX,
                height: auxiliaryHeight
            ),
            auxiliaryTopRightArea: IslandRect(
                x: gapCenter + notchWidth / 2,
                y: auxiliaryY,
                width: frame.maxX - (gapCenter + notchWidth / 2),
                height: auxiliaryHeight
            )
        )
    }
}

import XCTest
@testable import ConversationIslandCore

final class MotionTests: XCTestCase {
    func testEntranceUsesThePresentationSpringAndVisibleTarget() {
        XCTAssertEqual(
            MotionPlan.entrance(reducedMotion: false),
            MotionPlan(
                from: MotionTarget(opacity: 0, scaleX: 0.9, scaleY: 0.72),
                to: .visible,
                transition: .spring(stiffness: 224, damping: 25, mass: 1),
                completionVisibility: .visible
            )
        )
    }

    func testExitUsesApprovedCubicTimingAndHiddenTarget() {
        XCTAssertEqual(
            MotionPlan.exit(reducedMotion: false),
            MotionPlan(
                from: .visible,
                to: MotionTarget(opacity: 0, scaleX: 0.96, scaleY: 0.82),
                transition: .cubic(
                    durationMilliseconds: 180,
                    controlPoints: CubicBezier(x1: 0.4, y1: 0, x2: 1, y2: 1)
                ),
                completionVisibility: .hidden
            )
        )
    }

    func testReducedMotionMakesEntranceImmediatelyVisible() {
        XCTAssertEqual(
            MotionPlan.entrance(reducedMotion: true),
            MotionPlan(
                from: .visible,
                to: .visible,
                transition: .immediate(durationMilliseconds: 0),
                completionVisibility: .visible
            )
        )
    }

    func testReducedMotionMakesExitImmediatelyHidden() {
        XCTAssertEqual(
            MotionPlan.exit(reducedMotion: true),
            MotionPlan(
                from: .hidden,
                to: .hidden,
                transition: .immediate(durationMilliseconds: 0),
                completionVisibility: .hidden
            )
        )
    }
}

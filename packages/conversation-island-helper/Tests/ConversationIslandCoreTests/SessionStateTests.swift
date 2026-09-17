import XCTest
@testable import ConversationIslandCore

final class SessionStateTests: XCTestCase {
    func testIgnoresPresentWithLowerRevision() {
        var state = SessionState()
        _ = state.present(revision: 4, payload: payload(expanded: false))

        XCTAssertEqual(state.present(revision: 3, payload: payload(expanded: true)), [])
        XCTAssertEqual(state.revision, 4)
        XCTAssertFalse(state.payload?.expanded ?? true)
    }

    func testIgnoresDismissWithLowerRevision() {
        var state = SessionState()
        _ = state.present(revision: 4, payload: payload(expanded: false))

        XCTAssertEqual(state.dismiss(revision: 3), [])
        XCTAssertTrue(state.isVisible)
        XCTAssertFalse(state.isAnimating)
    }

    func testPresentDuringExitCancelsOldExitAndRejectsItsCompletion() {
        var state = SessionState()
        _ = state.present(revision: 1, payload: payload(expanded: false))
        _ = state.dismiss(revision: 2)

        XCTAssertEqual(
            state.present(revision: 3, payload: payload(expanded: true)),
            [
                .stopHoverTimers,
                .cancelExit,
                .show(revision: 3, payload: payload(expanded: true))
            ]
        )
        XCTAssertEqual(state.exitAnimationCompleted(revision: 2), [])
        XCTAssertTrue(state.isVisible)
        XCTAssertFalse(state.isAnimating)
    }

    func testDismissAnimatesExitForOrdinaryMotion() {
        var state = SessionState()
        _ = state.present(revision: 1, payload: payload(expanded: false, reducedMotion: false))

        XCTAssertEqual(
            state.dismiss(revision: 2),
            [.stopHoverTimers, .animateExit(revision: 2, durationMilliseconds: 180)]
        )
        XCTAssertTrue(state.isVisible)
        XCTAssertTrue(state.isAnimating)
    }

    func testDismissImmediatelyHidesAndAcknowledgesReducedMotion() {
        var state = SessionState()
        _ = state.present(revision: 1, payload: payload(expanded: false, reducedMotion: true))

        XCTAssertEqual(
            state.dismiss(revision: 2),
            [.stopHoverTimers, .hideAndAcknowledge(revision: 2)]
        )
        XCTAssertFalse(state.isVisible)
        XCTAssertFalse(state.isAnimating)
    }

    func testExitCompletionHidesAndResetsHoverState() {
        var state = SessionState()
        _ = state.present(revision: 1, payload: payload(expanded: false))
        _ = state.reduceHover(.pointerEntered)
        _ = state.dismiss(revision: 2)

        XCTAssertEqual(
            state.exitAnimationCompleted(revision: 2),
            [.stopHoverTimers, .hideAndAcknowledge(revision: 2)]
        )
        XCTAssertFalse(state.isVisible)
        XCTAssertFalse(state.isAnimating)
        XCTAssertEqual(state.hoverState, HoverState(expanded: false, dismissing: true))
    }

    func testShutdownStopsTimersHidesAndTerminates() {
        var state = SessionState()
        _ = state.present(revision: 1, payload: payload(expanded: false))
        _ = state.reduceHover(.pointerEntered)

        XCTAssertEqual(state.shutdown(), [.stopHoverTimers, .hide, .terminate])
        XCTAssertFalse(state.isVisible)
        XCTAssertFalse(state.isAnimating)
        XCTAssertEqual(state.hoverState, HoverState(expanded: false, dismissing: true))
    }

    private func payload(expanded: Bool, reducedMotion: Bool = false) -> PresentationPayload {
        PresentationPayload(
            displayId: 1,
            expanded: expanded,
            reducedMotion: reducedMotion,
            theme: PresentationTheme(appearance: .dark, primaryColor: "#00B96B", fontFamily: ""),
            primaryActivityId: "primary",
            activityCount: 1,
            activityCountText: "1 activity",
            activities: [
                PresentationActivity(
                    activityId: "primary",
                    identityAvatar: "",
                    identityName: "Assistant",
                    state: .streaming,
                    statusText: "Working",
                    title: "Title"
                )
            ]
        )
    }
}

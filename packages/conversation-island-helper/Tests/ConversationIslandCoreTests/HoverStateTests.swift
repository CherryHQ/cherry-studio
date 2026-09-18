import XCTest
@testable import ConversationIslandCore

final class HoverStateTests: XCTestCase {
    func testEnteringCompactSchedulesExpansionAfter500Milliseconds() {
        var state = HoverState(expanded: false, dismissing: false)

        XCTAssertEqual(state.reduce(.pointerEntered), [.scheduleExpand(milliseconds: 500)])
    }

    func testLeavingBeforeExpansionCancelsThePendingTimer() {
        var state = HoverState(expanded: false, dismissing: false)
        _ = state.reduce(.pointerEntered)

        XCTAssertEqual(state.reduce(.pointerExited), [.cancelExpand])
        XCTAssertEqual(state.reduce(.expandDelayElapsed), [])
    }

    func testOnlyTheCurrentExpansionTimerEmitsExpandedTrue() {
        var state = HoverState(expanded: false, dismissing: false)
        _ = state.reduce(.pointerEntered)

        XCTAssertEqual(state.reduce(.expandDelayElapsed), [.previewExpanded(true), .emitExpanded(true)])
        XCTAssertEqual(state.reduce(.expandDelayElapsed), [])
    }

    func testLeavingExpandedSchedulesCollapseAndReentryCancelsIt() {
        var state = HoverState(expanded: true, dismissing: false)

        XCTAssertEqual(state.reduce(.pointerExited), [.scheduleCollapse(milliseconds: 250)])
        XCTAssertEqual(state.reduce(.pointerEntered), [.cancelCollapse])
        XCTAssertEqual(state.reduce(.collapseDelayElapsed), [])
    }

    func testCurrentCollapseTimerEmitsExpandedFalse() {
        var state = HoverState(expanded: true, dismissing: false)
        _ = state.reduce(.pointerExited)

        XCTAssertEqual(state.reduce(.collapseDelayElapsed), [.previewExpanded(false), .emitExpanded(false)])
        XCTAssertEqual(state.reduce(.collapseDelayElapsed), [])
    }

    func testDismissingCancelsAllPendingTimersAndIgnoresStaleElapsedInputs() {
        var compact = HoverState(expanded: false, dismissing: false)
        _ = compact.reduce(.pointerEntered)
        XCTAssertEqual(
            compact.reduce(.snapshotChanged(expanded: false, dismissing: true)),
            [.cancelExpand]
        )
        XCTAssertEqual(compact.reduce(.expandDelayElapsed), [])

        var expanded = HoverState(expanded: true, dismissing: false)
        _ = expanded.reduce(.pointerExited)
        XCTAssertEqual(
            expanded.reduce(.snapshotChanged(expanded: true, dismissing: true)),
            [.cancelCollapse]
        )
        XCTAssertEqual(expanded.reduce(.collapseDelayElapsed), [])
    }

    func testOpeningActivityRequiresLeaveAndFreshEnterAfterCompactSnapshot() {
        var state = HoverState(expanded: true, dismissing: false)

        XCTAssertEqual(state.waitForFreshCompactEntry(), [])
        XCTAssertEqual(state.reduce(.snapshotChanged(expanded: false, dismissing: false)), [])
        XCTAssertEqual(state.reduce(.pointerEntered), [])
        XCTAssertEqual(state.reduce(.pointerExited), [])
        XCTAssertEqual(state.reduce(.pointerEntered), [.scheduleExpand(milliseconds: 500)])
    }

    func testLeavingBeforeCompactAllowsTheFirstFreshCompactEntry() {
        var state = HoverState(expanded: true, dismissing: false)

        _ = state.waitForFreshCompactEntry()
        XCTAssertEqual(state.reduce(.pointerExited), [])
        XCTAssertEqual(state.reduce(.snapshotChanged(expanded: false, dismissing: false)), [])
        XCTAssertEqual(state.reduce(.pointerEntered), [.scheduleExpand(milliseconds: 500)])
    }
}

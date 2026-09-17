import XCTest
@testable import ConversationIslandCore

final class SurfaceModelTests: XCTestCase {
    func testCollapsedSurfaceUsesThePayloadPrimaryActivity() {
        let primary = activity(id: "primary", title: "Primary")
        let payload = presentation(
            expanded: false,
            primaryActivityId: primary.activityId,
            activityCount: 2,
            activityCountText: "2 activities",
            activities: [primary]
        )

        XCTAssertEqual(
            SurfaceModel(payload: payload),
            .compact(primary: primary, activityCount: 2, activityCountText: "2 activities")
        )
    }

    func testExpandedSingleActivityUsesSingleDetail() {
        let primary = activity(id: "primary", title: "Primary")

        XCTAssertEqual(
            SurfaceModel(payload: presentation(expanded: true, activities: [primary])),
            .singleDetail(activity: primary)
        )
    }

    func testExpandedMultipleActivitiesPreservePayloadOrderAndPrimaryId() {
        let first = activity(id: "first", title: "First")
        let primary = activity(id: "primary", title: "Primary")
        let last = activity(id: "last", title: "Last")

        XCTAssertEqual(
            SurfaceModel(
                payload: presentation(
                    expanded: true,
                    primaryActivityId: primary.activityId,
                    activities: [first, primary, last]
                )
            ),
            .activityList(activities: [first, primary, last], primaryActivityId: primary.activityId)
        )
    }

    private func presentation(
        expanded: Bool,
        primaryActivityId: String = "primary",
        activityCount: Int = 1,
        activityCountText: String = "1 activity",
        activities: [PresentationActivity]
    ) -> PresentationPayload {
        PresentationPayload(
            displayId: 1,
            expanded: expanded,
            reducedMotion: false,
            theme: PresentationTheme(appearance: .dark, primaryColor: "#00B96B", fontFamily: ""),
            primaryActivityId: primaryActivityId,
            activityCount: activityCount,
            activityCountText: activityCountText,
            activities: activities
        )
    }

    private func activity(id: String, title: String) -> PresentationActivity {
        PresentationActivity(
            activityId: id,
            identityAvatar: "🌸",
            identityName: "Cherry",
            state: .streaming,
            statusText: "Responding",
            title: title
        )
    }
}

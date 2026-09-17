public enum SurfaceModel: Equatable, Sendable {
    case compact(primary: PresentationActivity, activityCount: Int, activityCountText: String)
    case singleDetail(activity: PresentationActivity)
    case activityList(activities: [PresentationActivity], primaryActivityId: String)

    public init(payload: PresentationPayload) {
        if !payload.expanded {
            let primary = payload.activities.first { $0.activityId == payload.primaryActivityId }!
            self = .compact(
                primary: primary,
                activityCount: payload.activityCount,
                activityCountText: payload.activityCountText
            )
        } else if payload.activities.count == 1 {
            self = .singleDetail(activity: payload.activities[0])
        } else {
            self = .activityList(
                activities: payload.activities,
                primaryActivityId: payload.primaryActivityId
            )
        }
    }
}

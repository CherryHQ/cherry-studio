public struct MotionTarget: Equatable, Sendable {
    public static let visible = MotionTarget(opacity: 1, scaleX: 1, scaleY: 1)
    public static let hidden = MotionTarget(opacity: 0, scaleX: 0.96, scaleY: 0.82)

    public let opacity: Double
    public let scaleX: Double
    public let scaleY: Double

    public init(opacity: Double, scaleX: Double, scaleY: Double) {
        self.opacity = opacity
        self.scaleX = scaleX
        self.scaleY = scaleY
    }
}

public struct CubicBezier: Equatable, Sendable {
    public let x1: Double
    public let y1: Double
    public let x2: Double
    public let y2: Double

    public init(x1: Double, y1: Double, x2: Double, y2: Double) {
        self.x1 = x1
        self.y1 = y1
        self.x2 = x2
        self.y2 = y2
    }
}

public enum MotionTransition: Equatable, Sendable {
    case spring(stiffness: Double, damping: Double, mass: Double)
    case cubic(durationMilliseconds: Int, controlPoints: CubicBezier)
    case immediate(durationMilliseconds: Int)
}

public enum MotionCompletionVisibility: Equatable, Sendable {
    case visible
    case hidden
}

public enum MotionPolicy {
    public static func shouldPulse(
        state: ActivityState,
        isVisible: Bool,
        reducedMotion: Bool
    ) -> Bool {
        isVisible && !reducedMotion && (state == .pending || state == .streaming)
    }
}

public struct MotionPlan: Equatable, Sendable {
    public let from: MotionTarget
    public let to: MotionTarget
    public let transition: MotionTransition
    public let completionVisibility: MotionCompletionVisibility

    public init(
        from: MotionTarget,
        to: MotionTarget,
        transition: MotionTransition,
        completionVisibility: MotionCompletionVisibility
    ) {
        self.from = from
        self.to = to
        self.transition = transition
        self.completionVisibility = completionVisibility
    }

    public static func entrance(reducedMotion: Bool) -> MotionPlan {
        guard !reducedMotion else {
            return MotionPlan(
                from: .visible,
                to: .visible,
                transition: .immediate(durationMilliseconds: 0),
                completionVisibility: .visible
            )
        }

        return MotionPlan(
            from: MotionTarget(opacity: 0, scaleX: 0.9, scaleY: 0.72),
            to: .visible,
            transition: .spring(stiffness: 224, damping: 25, mass: 1),
            completionVisibility: .visible
        )
    }

    public static func exit(reducedMotion: Bool) -> MotionPlan {
        guard !reducedMotion else {
            return MotionPlan(
                from: .hidden,
                to: .hidden,
                transition: .immediate(durationMilliseconds: 0),
                completionVisibility: .hidden
            )
        }

        return MotionPlan(
            from: .visible,
            to: .hidden,
            transition: .cubic(
                durationMilliseconds: 180,
                controlPoints: CubicBezier(x1: 0.4, y1: 0, x2: 1, y2: 1)
            ),
            completionVisibility: .hidden
        )
    }
}

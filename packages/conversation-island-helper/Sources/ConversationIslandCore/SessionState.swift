public enum SessionEffect: Equatable, Sendable {
    case stopHoverTimers
    case cancelExit
    case show(revision: Int64, payload: PresentationPayload)
    case animateExit(revision: Int64, durationMilliseconds: Int)
    case hideAndAcknowledge(revision: Int64)
    case hide
    case terminate
}

public struct SessionState: Equatable, Sendable {
    public private(set) var revision: Int64?
    public private(set) var payload: PresentationPayload?
    public private(set) var isVisible: Bool
    public private(set) var isAnimating: Bool
    public private(set) var hoverState: HoverState

    public init() {
        revision = nil
        payload = nil
        isVisible = false
        isAnimating = false
        hoverState = HoverState(expanded: false, dismissing: true)
    }

    public mutating func present(revision: Int64, payload: PresentationPayload) -> [SessionEffect] {
        guard accepts(revision) else {
            return []
        }

        var effects: [SessionEffect] = [.stopHoverTimers]
        if isAnimating {
            effects.append(.cancelExit)
        }

        clearPendingHoverState()
        _ = hoverState.reduce(.snapshotChanged(expanded: payload.expanded, dismissing: false))
        self.revision = revision
        self.payload = payload
        isVisible = true
        isAnimating = false
        effects.append(.show(revision: revision, payload: payload))
        return effects
    }

    public mutating func dismiss(revision: Int64) -> [SessionEffect] {
        guard accepts(revision) else {
            return []
        }

        var effects: [SessionEffect] = [.stopHoverTimers]
        if isAnimating {
            effects.append(.cancelExit)
        }

        self.revision = revision
        hoverState = HoverState(expanded: false, dismissing: true)

        if !isVisible || payload?.reducedMotion == true {
            isVisible = false
            isAnimating = false
            effects.append(.hideAndAcknowledge(revision: revision))
        } else {
            isAnimating = true
            effects.append(.animateExit(revision: revision, durationMilliseconds: 180))
        }

        return effects
    }

    public mutating func exitAnimationCompleted(revision: Int64) -> [SessionEffect] {
        guard self.revision == revision, isAnimating else {
            return []
        }

        isVisible = false
        isAnimating = false
        hoverState = HoverState(expanded: false, dismissing: true)
        return [.stopHoverTimers, .hideAndAcknowledge(revision: revision)]
    }

    public mutating func shutdown() -> [SessionEffect] {
        isVisible = false
        isAnimating = false
        hoverState = HoverState(expanded: false, dismissing: true)
        return [.stopHoverTimers, .hide, .terminate]
    }

    public mutating func reduceHover(_ input: HoverInput) -> [HoverEffect] {
        guard isVisible, !isAnimating else {
            return []
        }
        return hoverState.reduce(input)
    }

    public mutating func waitForFreshCompactEntry() -> [HoverEffect] {
        guard isVisible, !isAnimating else {
            return []
        }
        return hoverState.waitForFreshCompactEntry()
    }

    private func accepts(_ revision: Int64) -> Bool {
        guard let current = self.revision else {
            return true
        }
        return revision >= current
    }

    private mutating func clearPendingHoverState() {
        if hoverState.hasPendingExpand {
            _ = hoverState.reduce(.pointerExited)
        }
        if hoverState.hasPendingCollapse {
            _ = hoverState.reduce(.pointerEntered)
        }
    }
}

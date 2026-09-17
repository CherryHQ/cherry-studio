public enum HoverInput: Equatable, Sendable {
    case pointerEntered
    case pointerExited
    case snapshotChanged(expanded: Bool, dismissing: Bool)
    case expandDelayElapsed
    case collapseDelayElapsed
}

public enum HoverEffect: Equatable, Sendable {
    case scheduleExpand(milliseconds: Int)
    case scheduleCollapse(milliseconds: Int)
    case cancelExpand
    case cancelCollapse
    case emitExpanded(Bool)
}

public enum HoverFreshEntryState: Equatable, Sendable {
    case idle
    case waitingForCompactEnter
    case leftBeforeCompact
    case waitingForLeave
}

public struct HoverState: Equatable, Sendable {
    public static let expandDelayMilliseconds = 500
    public static let collapseDelayMilliseconds = 250

    public private(set) var expanded: Bool
    public private(set) var dismissing: Bool
    public private(set) var hasPendingExpand: Bool
    public private(set) var hasPendingCollapse: Bool
    public private(set) var freshEntryState: HoverFreshEntryState

    public init(expanded: Bool, dismissing: Bool) {
        self.expanded = expanded
        self.dismissing = dismissing
        hasPendingExpand = false
        hasPendingCollapse = false
        freshEntryState = .idle
    }

    public mutating func reduce(_ input: HoverInput) -> [HoverEffect] {
        switch input {
        case .pointerEntered:
            handlePointerEntered()
        case .pointerExited:
            handlePointerExited()
        case let .snapshotChanged(expanded, dismissing):
            handleSnapshotChanged(expanded: expanded, dismissing: dismissing)
        case .expandDelayElapsed:
            handleExpandDelayElapsed()
        case .collapseDelayElapsed:
            handleCollapseDelayElapsed()
        }
    }

    public mutating func waitForFreshCompactEntry() -> [HoverEffect] {
        guard !dismissing else {
            return []
        }

        freshEntryState = .waitingForCompactEnter
        var effects: [HoverEffect] = []
        cancelExpand(into: &effects)
        cancelCollapse(into: &effects)
        return effects
    }

    private mutating func handlePointerEntered() -> [HoverEffect] {
        guard !dismissing else {
            return []
        }

        var effects: [HoverEffect] = []
        cancelCollapse(into: &effects)

        switch freshEntryState {
        case .leftBeforeCompact:
            if expanded {
                freshEntryState = .waitingForLeave
                return effects
            }
            freshEntryState = .idle
        case .waitingForCompactEnter:
            if !expanded {
                freshEntryState = .waitingForLeave
            }
            return effects
        case .waitingForLeave:
            return effects
        case .idle:
            break
        }

        guard !expanded, !hasPendingExpand else {
            return effects
        }

        hasPendingExpand = true
        effects.append(.scheduleExpand(milliseconds: Self.expandDelayMilliseconds))
        return effects
    }

    private mutating func handlePointerExited() -> [HoverEffect] {
        guard !dismissing else {
            return []
        }

        var effects: [HoverEffect] = []
        cancelExpand(into: &effects)

        if freshEntryState != .idle {
            cancelCollapse(into: &effects)
            if expanded, freshEntryState == .waitingForCompactEnter {
                freshEntryState = .leftBeforeCompact
            } else if !expanded, freshEntryState == .waitingForLeave {
                freshEntryState = .idle
            }
            return effects
        }

        guard expanded, !hasPendingCollapse else {
            return effects
        }

        hasPendingCollapse = true
        effects.append(.scheduleCollapse(milliseconds: Self.collapseDelayMilliseconds))
        return effects
    }

    private mutating func handleSnapshotChanged(expanded: Bool, dismissing: Bool) -> [HoverEffect] {
        self.expanded = expanded
        self.dismissing = dismissing
        var effects: [HoverEffect] = []

        if dismissing {
            cancelExpand(into: &effects)
            cancelCollapse(into: &effects)
            freshEntryState = .idle
        } else if expanded {
            cancelExpand(into: &effects)
        } else {
            cancelCollapse(into: &effects)
        }

        return effects
    }

    private mutating func handleExpandDelayElapsed() -> [HoverEffect] {
        guard hasPendingExpand, !dismissing else {
            return []
        }

        hasPendingExpand = false
        return [.emitExpanded(true)]
    }

    private mutating func handleCollapseDelayElapsed() -> [HoverEffect] {
        guard hasPendingCollapse, !dismissing else {
            return []
        }

        hasPendingCollapse = false
        return [.emitExpanded(false)]
    }

    private mutating func cancelExpand(into effects: inout [HoverEffect]) {
        guard hasPendingExpand else {
            return
        }

        hasPendingExpand = false
        effects.append(.cancelExpand)
    }

    private mutating func cancelCollapse(into effects: inout [HoverEffect]) {
        guard hasPendingCollapse else {
            return
        }

        hasPendingCollapse = false
        effects.append(.cancelCollapse)
    }
}

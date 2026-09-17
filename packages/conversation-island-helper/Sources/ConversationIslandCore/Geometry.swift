public struct IslandSize: Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }
}

public struct IslandRect: Equatable, Sendable {
    public static let zero = IslandRect(x: 0, y: 0, width: 0, height: 0)

    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public var minX: Double { x }
    public var midX: Double { x + width / 2 }
    public var maxX: Double { x + width }
    public var minY: Double { y }
    public var midY: Double { y + height / 2 }
    public var maxY: Double { y + height }

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct IslandInsets: Equatable, Sendable {
    public let top: Double
    public let left: Double
    public let bottom: Double
    public let right: Double

    public init(top: Double, left: Double, bottom: Double, right: Double) {
        self.top = top
        self.left = left
        self.bottom = bottom
        self.right = right
    }
}

public struct ScreenGeometry: Equatable, Sendable {
    public let frame: IslandRect
    public let safeAreaInsets: IslandInsets
    public let auxiliaryTopLeftArea: IslandRect
    public let auxiliaryTopRightArea: IslandRect

    public init(
        frame: IslandRect,
        safeAreaInsets: IslandInsets,
        auxiliaryTopLeftArea: IslandRect,
        auxiliaryTopRightArea: IslandRect
    ) {
        self.frame = frame
        self.safeAreaInsets = safeAreaInsets
        self.auxiliaryTopLeftArea = auxiliaryTopLeftArea
        self.auxiliaryTopRightArea = auxiliaryTopRightArea
    }
}

public enum IslandPresentation: Equatable, Sendable {
    case notch
    case capsule
}

public struct IslandPlacement: Equatable, Sendable {
    public let bounds: IslandRect
    public let presentation: IslandPresentation
    public let notchWidth: Double?

    public init(bounds: IslandRect, presentation: IslandPresentation, notchWidth: Double?) {
        self.bounds = bounds
        self.presentation = presentation
        self.notchWidth = notchWidth
    }
}

public enum IslandGeometry {
    public static let fallbackTopOffset = 8.0
    public static let minNotchWidth = 40.0
    public static let maxNotchWidth = 260.0
    public static let topEdgeTolerance = 2.0
    public static let centerToleranceRatio = 0.1
    public static let expandedWidth = 420.0
    public static let minCompactNotchWidth = 280.0
    public static let compactNotchSideWidth = 80.0
    public static let expandedHeaderHeight = 38.0
    public static let singleDetailHeight = 44.0
    public static let activityListRowHeight = 52.0
    public static let maximumVisibleExpandedRows = 4
    public static let compactSize = IslandSize(width: 320, height: 38)

    public static func expandedSize(activityCount: Int) -> IslandSize {
        let contentHeight = activityCount == 1
            ? singleDetailHeight
            : Double(min(maximumVisibleExpandedRows, activityCount)) * activityListRowHeight
        return IslandSize(width: expandedWidth, height: expandedHeaderHeight + contentHeight)
    }

    public static func placement(on screen: ScreenGeometry, size: IslandSize) -> IslandPlacement {
        guard let notchWidth = plausibleNotchWidth(on: screen) else {
            return fallbackPlacement(on: screen, size: size)
        }

        let left = screen.auxiliaryTopLeftArea
        let gapCenter = left.maxX + notchWidth / 2
        let width = size == compactSize
            ? min(expandedWidth, max(minCompactNotchWidth, notchWidth + compactNotchSideWidth * 2))
            : size.width

        return IslandPlacement(
            bounds: IslandRect(
                x: gapCenter - width / 2,
                y: screen.frame.maxY - size.height,
                width: width,
                height: size.height
            ),
            presentation: .notch,
            notchWidth: notchWidth
        )
    }

    private static func plausibleNotchWidth(on screen: ScreenGeometry) -> Double? {
        guard screen.safeAreaInsets.top > 0 else {
            return nil
        }

        let frame = screen.frame
        let left = screen.auxiliaryTopLeftArea
        let right = screen.auxiliaryTopRightArea
        let gapWidth = right.minX - left.maxX
        let gapCenter = left.maxX + gapWidth / 2
        let isAtTop = abs(left.maxY - frame.maxY) <= topEdgeTolerance
            && abs(right.maxY - frame.maxY) <= topEdgeTolerance
        let isPlausibleWidth = (minNotchWidth...maxNotchWidth).contains(gapWidth)
        let isCentered = abs(gapCenter - frame.midX) <= frame.width * centerToleranceRatio

        return isAtTop && isPlausibleWidth && isCentered ? gapWidth : nil
    }

    private static func fallbackPlacement(on screen: ScreenGeometry, size: IslandSize) -> IslandPlacement {
        IslandPlacement(
            bounds: IslandRect(
                x: screen.frame.midX - size.width / 2,
                y: screen.frame.maxY - fallbackTopOffset - size.height,
                width: size.width,
                height: size.height
            ),
            presentation: .capsule,
            notchWidth: nil
        )
    }
}

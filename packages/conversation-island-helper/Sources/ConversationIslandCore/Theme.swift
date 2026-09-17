import Foundation

public struct RGBAColor: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double
    public let alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

public struct HexColor: Equatable, Sendable {
    public static let fallback = HexColor(
        rgba: RGBAColor(red: 0, green: 185.0 / 255.0, blue: 107.0 / 255.0, alpha: 1),
        canonicalHex: "#00B96B"
    )

    public let rgba: RGBAColor
    public let canonicalHex: String

    public init(rgba: RGBAColor, canonicalHex: String) {
        self.rgba = rgba
        self.canonicalHex = canonicalHex
    }

    public init(_ rawValue: String) {
        guard let parsed = Self.parse(rawValue) else {
            self = Self.fallback
            return
        }

        self = parsed
    }

    private static func parse(_ rawValue: String) -> HexColor? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.first == "#" else {
            return nil
        }

        let digits = String(trimmed.dropFirst())
        guard digits.count == 3 || digits.count == 6 else {
            return nil
        }
        guard digits.utf8.allSatisfy(isASCIIHexDigit) else {
            return nil
        }

        let expanded = digits.count == 3
            ? digits.map { String(repeating: String($0), count: 2) }.joined()
            : digits
        let canonicalHex = "#" + expanded.uppercased()
        let channels = Array(expanded.utf8)
        let red = channel(high: channels[0], low: channels[1])
        let green = channel(high: channels[2], low: channels[3])
        let blue = channel(high: channels[4], low: channels[5])

        return HexColor(
            rgba: RGBAColor(
                red: Double(red) / 255,
                green: Double(green) / 255,
                blue: Double(blue) / 255,
                alpha: 1
            ),
            canonicalHex: canonicalHex
        )
    }

    private static func isASCIIHexDigit(_ value: UInt8) -> Bool {
        (48...57).contains(value) || (65...70).contains(value) || (97...102).contains(value)
    }

    private static func channel(high: UInt8, low: UInt8) -> UInt8 {
        nibble(high) * 16 + nibble(low)
    }

    private static func nibble(_ value: UInt8) -> UInt8 {
        switch value {
        case 48...57:
            value - 48
        case 65...70:
            value - 55
        default:
            value - 87
        }
    }
}

public func parseFontFamily(_ rawValue: String) -> String? {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

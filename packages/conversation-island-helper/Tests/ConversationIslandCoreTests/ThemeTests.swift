import XCTest
@testable import ConversationIslandCore

final class ThemeTests: XCTestCase {
    func testParsesTrimmedShortHexAndNormalizesIt() {
        XCTAssertEqual(
            HexColor("  #aB3\n"),
            HexColor(
                rgba: RGBAColor(red: 170.0 / 255.0, green: 187.0 / 255.0, blue: 51.0 / 255.0, alpha: 1),
                canonicalHex: "#AABB33"
            )
        )
    }

    func testParsesSixDigitHexCaseInsensitively() {
        XCTAssertEqual(
            HexColor("#00b96B"),
            HexColor(
                rgba: RGBAColor(red: 0, green: 185.0 / 255.0, blue: 107.0 / 255.0, alpha: 1),
                canonicalHex: "#00B96B"
            )
        )
    }

    func testInvalidColorsFallBackToCherryGreen() {
        let invalidValues = ["", "red", "#12", "#1234", "#00112233", "rgb(0, 185, 107)", "#GGGGGG"]
        let fallback = HexColor(
            rgba: RGBAColor(red: 0, green: 185.0 / 255.0, blue: 107.0 / 255.0, alpha: 1),
            canonicalHex: "#00B96B"
        )

        for invalidValue in invalidValues {
            XCTAssertEqual(HexColor(invalidValue), fallback)
        }
    }

    func testFontFamilyReturnsTrimmedNonEmptyValue() {
        XCTAssertEqual(parseFontFamily("  SF Pro Display \n"), "SF Pro Display")
    }

    func testFontFamilyReturnsNilForWhitespaceOnlyValue() {
        XCTAssertNil(parseFontFamily(" \n\t "))
    }
}

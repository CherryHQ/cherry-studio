import AVFAudio
import Testing
@testable import SystemSpeechHelper

@Suite("Apple language default voice")
struct AppleTtsTests {
    @Test(arguments: ["zh-CN", "en-US"])
    func resolvesInstalledNativeDefault(locale: String) {
        let expected = AVSpeechSynthesisVoice(language: locale)
        let installed = AVSpeechSynthesisVoice.speechVoices()
        let available = expected.flatMap { voice in
            installed.first { $0.identifier == voice.identifier && $0.language == locale }
        }
        let result = AppleTts.defaultVoice(locale: locale)
        #expect(result?.id == available?.identifier)
        #expect(result?.locale == available?.language)
    }

    @Test
    func neverSubstitutesAnUnrelatedLanguage() {
        #expect(AppleTts.defaultVoice(locale: "zz-ZZ") == nil)
    }
}

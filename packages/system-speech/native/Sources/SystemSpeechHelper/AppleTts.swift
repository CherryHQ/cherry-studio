import AVFAudio

enum AppleTts {
    static func installedVoices() -> [InstalledVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .map { voice in
                InstalledVoice(
                    id: voice.identifier,
                    name: voice.name,
                    locale: voice.language,
                    quality: voice.quality.rawValue
                )
            }
            .sorted { $0.id < $1.id }
    }
}

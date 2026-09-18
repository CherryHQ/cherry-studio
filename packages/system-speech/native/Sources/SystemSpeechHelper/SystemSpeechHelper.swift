import Foundation

@main
enum SystemSpeechHelper {
    static func main() async {
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let request = try JSONDecoder().decode(NativeRequest.self, from: data)
            let command = try request.validated()
            try await execute(command)
        } catch let error as HelperError {
            write(FailureEnvelope(error: error))
        } catch is DecodingError {
            write(FailureEnvelope(error: HelperError(code: .invalidRequest)))
        } catch {
            write(FailureEnvelope(error: HelperError(code: .nativeHelperFailed)))
        }
    }

    private static func execute(_ command: ValidatedCommand) async throws {
        switch command {
        case let .capabilities(locale):
            let apple = await AppleAsr.capabilities(locale: locale)
            let result = CapabilitiesResult(
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                requestedLocale: locale,
                supportedLocale: apple.supportedLocale,
                appleAssetStatus: apple.assetStatus,
                voices: AppleTts.installedVoices()
            )
            write(SuccessEnvelope(value: CapabilitiesSuccess(result: result)))
        case let .installAsrAssets(locale):
            let installedLocale = try await AppleAsr.installAssets(locale: locale)
            write(
                SuccessEnvelope(
                    value: InstallAsrAssetsSuccess(
                        result: InstallAsrAssetsResult(locale: installedLocale)
                    )
                )
            )
        case let .synthesize(voiceId, text, outputPath):
            let result = try await AppleTts.synthesize(voiceId: voiceId, text: text, outputPath: outputPath)
            write(SuccessEnvelope(value: SynthesizeSuccess(result: result)))
        case let .transcribe(locale, inputPath):
            let result = try await AppleAsr.transcribe(locale: locale, inputPath: inputPath)
            write(SuccessEnvelope(value: TranscribeSuccess(result: result)))
        }
    }

    private static func write<Value: Encodable & Sendable>(_ value: Value) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

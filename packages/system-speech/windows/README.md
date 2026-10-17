# Windows SAPI helper

Windows x64 system ASR uses installed SAPI 5 recognizers, selected by exact locale.
On Windows x64, `resolveDefaultAsrModel` recommends `local-voice::windows-system-asr`
when no model is explicitly selected. An explicit selection is preserved. Main accepts the same recorded WebM/Opus
as Apple ASR and decodes it to mono 16 kHz PCM16 WAV in `voice.audio` before calling
the helper. Canonical PCM16 mono 16 kHz WAV is validated with `inspectCanonicalWav`
and passed through unchanged. The helper never selects a different language, downloads a model or
uses cloud recognition. An omitted language uses `en-US` for both readiness and
transcription. Windows ASR has no asset installation operation.

Windows x64 system TTS uses installed SAPI 5 voice tokens and writes mono 16 kHz
PCM16 WAV files. It requires an exact `voiceId` and a numeric `speed` from 0.5 to
2; missing voices are never substituted. The speed maps to SAPI's integer rate
range, so it is a relative voice setting rather than a guaranteed duration ratio.
Windows ARM64 system speech remains unsupported; ARM64 application packaging
neither builds nor includes this helper.

The helper accepts one JSON request on stdin and returns one JSON envelope on
stdout. Text and paths are never command-line arguments. It emits no diagnostics
to stderr. The native client hides the process window and waits for process exit
after cancellation or timeout before Main reclaims temporary files. The default
request deadline is 120 seconds. Helper failure envelopes contain stable codes,
not COM errors or request contents.

`capabilities.voices` is independent of ASR support. The existing ASR field
`appleAssetStatus` remains unchanged for compatibility: `installed` means a
matching SAPI recognizer token exists, and `unsupported` means none exists. TTS
must use `voices`, never this ASR status or `supportedLocale`. ASR discovery uses
`list_asr_locales` and lists installed recognizer tokens. Readiness uses `probe_asr`,
which creates the selected in-process recognizer, a context and a dictation
grammar without setting audio input or activating recognition. A token alone
does not prove readiness; initialization alone does not prove recognition quality.
`transcribe` consumes the derived WAV. Main maps an empty transcript to `no_speech`,
retains the original recording for retry on failure, and removes derived audio
after completion, cancellation or timeout. Only SAPI voices appear; Windows voices exposed solely through
other APIs are not listed. No assets are downloaded by the helper.

## Build

Install Visual Studio C++ x64 build tools, C++ ATL, and the Windows SDK, including its
C++/WinRT headers. The build locates Visual Studio with `vswhere` and activates
its x64 toolchain; an existing x64 Native Tools prompt also works. MSVC's static
runtime is linked, so users do not need build tools or a separate VC runtime for
the helper.

From the repository root on Windows x64:

```powershell
pnpm install
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech build:native -- --arch x64
pnpm --filter @cherrystudio/system-speech smoke:windows
pnpm --filter @cherrystudio/system-speech smoke:windows:tts
pnpm --filter @cherrystudio/system-speech smoke:windows:asr
```

The output is `packages/system-speech/dist/native/win32-x64/cherry-system-speech.exe`.
`windows/build.cmd` is the equivalent direct build entry. `windows/smoke.ps1`
runs the protocol smoke against an already built helper; add `-Tts` for actual
voice synthesis. The JavaScript package must also be built first.

The protocol smoke needs no voice or recognizer: it checks typed responses,
voice enumeration with an unsupported ASR locale, malformed requests, required
speed bounds, invalid ASR probes and exact missing-voice/recognizer failure. The TTS smoke **requires an installed
SAPI voice** and fails explicitly if none exists. It checks actual PCM data and
metadata, a Unicode path and text, 0.5/1/2 speed settings, cancellation and timeout,
then removes its temporary files. It does not play audio. The Windows workflow runs the adapter unit regression and both native smokes.
The regression mocks the helper and does not recognize speech; only a successful
Windows run of the native smokes is native execution evidence.

The ASR smoke **requires a usable en-US SAPI dictation recognizer and an en-US
SAPI voice**. It probes the engine, synthesizes a known sentence, transcribes it
and checks expected words, then checks silence, cancellation, timeout and scratch
cleanup. Missing engines fail explicitly. It is a pipeline check, not an accuracy
benchmark. Hosted `windows-2022` runners do not guarantee a dictation engine, so
the workflow's protocol/TTS checks do not count as ASR execution evidence. Run
this additional smoke on a Windows x64 machine with the required engine installed.

## Packaging and device acceptance

`before-pack.js` builds only the Windows x64 target and adds its executable to
`resources/system-speech/cherry-system-speech.exe` outside asar. It removes the
resource entry before an ARM64 packaging pass. electron-builder's extra-resource
copy transformer signs `.exe` files with the existing `scripts/packaging/win-sign.js`
policy when `WIN_SIGN` is enabled; no separate signing credentials are introduced.

Check an unpacked application directory, an NSIS installation directory, or the
active extraction directory of a running portable application:

```powershell
pnpm --filter @cherrystudio/system-speech smoke:packaged:windows -- 'C:\path\Cherry Studio'
pnpm --filter @cherrystudio/system-speech smoke:packaged:windows -- 'C:\path\Cherry Studio' --require-signature
pnpm --filter @cherrystudio/system-speech smoke:packaged:windows -- 'C:\path\Cherry Studio' --asr
```

This verifies that both app and helper are x64 PE executables, then runs the
protocol and real TTS smokes against the packaged helper. The second command
also requires valid Authenticode signatures on both executables. A result with
`signatureVerified: false` is an unsigned smoke, not release-signing evidence.

Native smoke is not full application acceptance. On Windows x64, test both NSIS
and portable launches: enumerate installed voices, synthesize with the selected
voice and speed, play and stop audio, cancel long synthesis, handle a removed
voice, and confirm there is no console window or private text in diagnostics.
Repeat with no installed recognizer to confirm TTS remains available. Verify an
ARM64 application package still builds and reports system speech unsupported.
For ASR, select the Windows model explicitly and test real en-US and zh-CN
recordings with their matching engines, silence, malformed audio, an unavailable
locale, cancellation during decode and recognition, timeout, and owner window
closure. Check that a failed recording can be retried and scratch WAVs are removed.
Record OS build, architecture, package type, installed voices and smoke outcome;
macOS tests and source inspection cannot establish Windows support.

API references: [SAPI WAV recognition](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms717071%28v%3Dvs.85%29),
[in-process input](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee413281%28v%3Dvs.85%29),
[dictation loading](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee413304%28v%3Dvs.85%29),
[SAPI voice output](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms719788%28v%3Dvs.85%29),
[WinRT JSON in desktop apps](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support).

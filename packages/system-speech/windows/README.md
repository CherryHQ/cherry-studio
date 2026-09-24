# Windows SAPI helper prototype

This standalone x64 prototype follows the existing native helper's single-request
stdin/stdout JSON envelope for `capabilities`, `transcribe`, and `synthesize`.
It also exposes `list_asr_locales`, which the runtime foundation client does not
yet call. It enumerates installed SAPI 5 recognizer and voice tokens,
transcribes a WAV file with an in-process dictation recognizer, and renders a
16 kHz mono PCM WAV file with an exact voice token. It never prints input text,
transcripts, audio, paths, or COM errors to stderr.

This prototype is not wired into Cherry Studio's Main adapter or Windows package.
The shared `capabilities` contract currently names its ASR availability field
`appleAssetStatus`; here `installed` means a matching SAPI recognizer token was
found, while `unsupported` means none was found. A token does not prove that its
dictation engine works. Windows may expose voices through APIs other than SAPI;
only SAPI voices appear here. The runtime foundation `synthesize` request has no
`speed` field, so this helper defaults to 1; an explicitly supplied speed must
still be a number from 0.5 to 2.

Build from an **x64 Native Tools Command Prompt for Visual Studio** with the
Windows SDK and C++/WinRT headers installed:

```cmd
packages\system-speech\windows\build.cmd
```

Then run the protocol smoke from the same prompt:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File packages\system-speech\windows\smoke.ps1
```

The smoke checks JSON responses and invalid-request handling. Real Windows x64
validation must additionally test an installed recognizer's WAV dictation,
installed voices and WAV output, long silence, cancellation, and launch from both
NSIS and portable packages. The caller must impose a deadline and terminate the
helper on cancellation; the existing native client defaults to 120 seconds.

API references: [SAPI WAV recognition](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms717071%28v%3Dvs.85%29),
[SAPI voice output](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms719788%28v%3Dvs.85%29),
[WinRT JSON in desktop apps](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support).

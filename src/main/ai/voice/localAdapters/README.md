# Private local Voice adapters

Model definitions expose typed operation tables; `execution.ts` selects an operation
and the model catalog derives `voiceCapabilities` from those same tables.
`sdkOperations` wraps SDK models with independently observable results and cleanup.
`VoiceCleanupError` preserves the public failure reason while keeping failed cleanup
visible through `closed` and `cancel()`; the owning session retains that failed handle.

`scratch` owns temporary directories and requires the adapter to supply error mapping.
`systemSpeech` owns the system helper client and its error conversion;
`recordingDecoder` owns the shared recording decode request and timeout.
Cancellation checks use `checkAbort` from the voice error module.

`voiceAudioProcess` declares the `voice.audio` utility process. VoiceSessionService
registers it. Apple, FunASR, Qwen3-ASR, and Windows ASR pass canonical WAV bytes through
`inspectCanonicalWav` and request `decode` only for WebM. Every decode uses a
combined owner/caller/timeout AbortSignal. The process
uses terminate cancellation, so the caller cannot release its operation lease before
the old generation exits.

`decodeWebm` uses Mediabunny for WebM packet demux and WAV mux, ts-ebml for metadata
that Mediabunny does not expose, and opus-decoder's libopus WASM for 16 kHz decode.
It averages mono/stereo channels into PCM16. It does not open files, write scratch
audio, resolve physical paths, download resources or access the network. Adapters
own their derived WAV files and delete them in their lifecycle cleanup.

The accepted recording subset is one WebM Opus audio track, OpusHead version 1,
mapping family 0, mono/stereo, zero output gain, and unlaced blocks. Opus pre-skip
is applied once; CodecDelay must agree with it. Positive DiscardPadding is accepted
only on the last block and removed from decoded samples. Negative padding, padding
inside the stream, multiple tracks, video, encryption, attachments and non-Opus
codecs are rejected. ts-ebml 3.0.2 cannot read signed integers wider than six bytes;
those encodings fail with `VOICE_AUDIO_INVALID`, including an eight-byte padding
field. This is a bounded MediaRecorder input contract, not a general media importer.
Canonical WAV is separate: `inspectCanonicalWav` rejects more than 32 MiB with `invalid_audio` and does not apply the five-minute cap.

Limits: 32 MiB encoded input, five minutes decoded audio, 200,000 metadata elements,
and libopus's packet buffer limit. The adapter supplies a 30-second decoding timeout;
the host terminates the utility process even if a third-party parser is synchronous.
Malformed inputs produce fixed category errors; library messages and contents are
never returned. The decoder stores no files, so abort leaves no derived disk state.

See [the fixture provenance](./__tests__/fixtures/README.md) and
[dependency notices](./NOTICE.txt). Keep the notices in the packaged application.

`qwen3Asr` converts validated PCM16 WAV samples into 16 kHz Float32 PCM, preserving byte
view offsets, and sends them to the existing ASR inference service. It creates no scratch
files. It also adapts mono 16 kHz PCM streams to full-text revisions through the same ASR queue. MLX platform support is shared with Qwen3-TTS in
`voicePlatform`; native loading and model caches remain in the utility process.

Apple TTS declares both complete audio and PCM streaming. Its streaming execution
owns the system helper handle through `systemSpeech`; the package owns native
callback framing, backpressure and process cleanup. It reuses VoiceSessionService
and VoiceStream playback credits without another utility process or temporary WAV.
The source AudioContext converts the declared native sample rate for the device.

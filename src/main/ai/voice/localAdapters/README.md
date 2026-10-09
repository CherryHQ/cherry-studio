# Private local Voice adapters

`voiceAudioProcess` declares the `voice.audio` utility process. VoiceSessionService
registers it; Apple requests `decode` with Main-read FileEntry bytes and a combined
owner/caller/timeout AbortSignal. The process uses terminate cancellation, so the
caller cannot release its operation lease before the old generation exits.

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

Limits: 32 MiB encoded input, five minutes decoded audio, 200,000 metadata elements,
and libopus's packet buffer limit. The adapter supplies a 30-second decoding timeout;
the host terminates the utility process even if a third-party parser is synchronous.
Malformed inputs produce fixed category errors; library messages and contents are
never returned. The decoder stores no files, so abort leaves no derived disk state.

See [the fixture provenance](./__tests__/fixtures/README.md) and
[dependency notices](./NOTICE.txt). Keep the notices in the packaged application.

# Voice recording fixture

`media-recorder-opus.webm` was produced for these tests with Chrome 153 on macOS,
using an isolated Playwright browser and the real `MediaRecorder` API. It contains
synthetic tones only: left 440 Hz, right 880 Hz, amplitude 0.2, generated from a
48 kHz stereo AudioBuffer and routed to a MediaStreamAudioDestinationNode.
No microphone, user recording, online resource, or ffmpeg was used.

The recorder used `audio/webm;codecs=opus`, 64 kbit/s, and stopped when the one-second
source finished. The resulting fixture is 8,072 bytes and contains sixteen 60 ms
Opus packets. Chrome's `decodeAudioData` independently returned 46,080 samples per
channel at 48 kHz (0.96 seconds). Container timestamps report about 0.897 seconds;
they must not be used to truncate these decoded samples.

The decoder tests assert the PCM duration, both tone frequencies after downmix,
the WAV container, and 16 kHz mono output. Tests derive additional valid WebM files
with ts-ebml's encoder while retaining the actual recorded Opus packets, to cover
pre-skip, discard padding, codec rejection, track rejection, and duration limits.
This fixture proves format handling; it is not speech-recognition evidence.

`media-recorder-opus.ogg` is a lossless packet remux of `media-recorder-opus.webm`
using the pinned Mediabunny 1.58.0: WebM Input → EncodedPacketSink →
EncodedAudioPacketSource('opus') → OggOutputFormat / BufferTarget. The decoder
configuration is preserved. Run from the repository root:

```sh
node src/main/ai/voice/localAdapters/__tests__/fixtures/generate-ogg-fixture.mjs
```

The source is the same one-second synthetic stereo signal: left 440 Hz, right
880 Hz, amplitude 0.2. Packet timestamps are rebuilt by accumulating packet
durations: the WebM timestamps report about 0.897 seconds despite 0.96 seconds
of actual decoded audio. The OGG has 16 packets and yields 15,360 samples at
16 kHz. It is 7,824 bytes; SHA256:
`c0853cd2fce825ba18e83d8cadbe04c1021bbf38272c5dcc6f777db9edfff9fe`.
Mediabunny chooses a random OGG serial number, so rerunning changes the hash
while preserving packet content and duration. No microphone or personal recording,
no ffmpeg, and no network access are involved. This only proves format handling;
it is not speech-recognition evidence.

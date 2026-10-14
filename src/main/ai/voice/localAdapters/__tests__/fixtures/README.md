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

# Audio

Data comes from the model catalog bundled with Cherry Studio ([provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)), synced automatically with the application repository; a `-` means the source data does not provide that field.

Context length and max output are abbreviated with K / M and rounded (1K is roughly 1,000–1,024 tokens, 1M roughly one million), e.g. 131,072 and 128,000 both read 128K. Hover a value to see the exact number; confirm limits with the model provider.

> **Data updated**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (Beijing time)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:Function calling,Reasoning,Image recognition,Speech recognition,Speech generation,Video understanding,Structured output,File input;in:5:Text input=Text,Image input=Image,Audio input=Audio,Video input=Video;out:6:Text output=Text,Audio output=Audio">

| Model | Provider | Context | Max output | Capabilities | Input modalities | Output modalities |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen-Omni Turbo<br><code>qwen-omni-turbo</code> | alibaba | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Function calling, Image recognition, Speech recognition, Speech generation, Video understanding | Text, Image, Audio, Video | Text, Audio |
| Qwen-Omni Turbo Realtime<br><code>qwen-omni-turbo-realtime</code> | alibaba | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Function calling, Image recognition, Speech recognition, Speech generation | Text, Image, Audio | Text, Audio |
| Qwen2.5-Omni 7B<br><code>qwen2-5-omni-7b</code> | alibaba | <span title="32,768">32K</span> | <span title="2,048">2K</span> | Function calling, Image recognition, Speech recognition, Speech generation, Video understanding | Text, Image, Audio, Video | Text, Audio |
| Qwen3-ASR Flash<br><code>qwen3-asr-flash</code> | alibaba | <span title="53,248">52K</span> | <span title="4,096">4K</span> | Speech recognition | Audio | Text |
| Qwen3-LiveTranslate Flash Realtime<br><code>qwen3-livetranslate-flash-realtime</code> | alibaba | <span title="53,248">52K</span> | <span title="4,096">4K</span> | Image recognition, Speech recognition, Speech generation, Video understanding | Text, Image, Audio, Video | Text, Audio |
| Qwen3-Omni Flash<br><code>qwen3-omni-flash</code> | alibaba | <span title="65,536">64K</span> | <span title="16,384">16K</span> | Function calling, Reasoning, Image recognition, Speech recognition, Speech generation, Video understanding | Text, Image, Audio, Video | Text, Audio |
| Qwen3-Omni Flash Realtime<br><code>qwen3-omni-flash-realtime</code> | alibaba | <span title="65,536">64K</span> | <span title="16,384">16K</span> | Function calling, Image recognition, Speech recognition, Speech generation, Video understanding | Text, Image, Audio, Video | Text, Audio |
| ElevenLabs Music<br><code>elevenlabs-music</code> | elevenlabs | - | - | Speech generation | Text | Audio |
| ElevenLabs v2.5 Turbo<br><code>elevenlabs-v2-5-turbo</code> | elevenlabs | - | - | Speech generation | Text | Audio |
| ElevenLabs v3<br><code>elevenlabs-v3</code> | elevenlabs | - | - | Speech generation | Text | Audio |
| Gemini 2.5 Flash Preview TTS<br><code>gemini-2-5-flash-preview-tts</code> | google | <span title="8,192">8K</span> | - | Speech generation | Text | Audio |
| Gemini 2.5 Flash TTS<br><code>gemini-2-5-flash-tts</code> | google | <span title="32,768">32K</span> | <span title="16,384">16K</span> | Speech generation | Text | Audio |
| Gemini 2.5 Pro Preview TTS<br><code>gemini-2-5-pro-preview-tts</code> | google | <span title="8,192">8K</span> | - | Speech generation | Text | Audio |
| Gemini 2.5 Pro TTS<br><code>gemini-2-5-pro-tts</code> | google | <span title="32,768">32K</span> | <span title="16,384">16K</span> | Speech generation | Text | Audio |
| Gemini 3.1 Flash Live Preview<br><code>gemini-3-1-flash-live-preview</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | Function calling, Reasoning, Image recognition, Speech recognition, Speech generation, Video understanding, File input | Text, Image, Audio, Video | Text, Audio |
| Gemini 3.1 Flash TTS Preview<br><code>gemini-3-1-flash-tts-preview</code> | google | <span title="8,192">8K</span> | - | Reasoning, Speech generation | Text | Audio |
| Gemini 3.5 Live Translate Preview<br><code>gemini-3-5-live-translate-preview</code> | google | <span title="16,384">16K</span> | - | Speech recognition, Speech generation | Audio | Text, Audio |
| Gemini 3.5 Transcribe<br><code>gemini-3-5-transcribe</code> | google | - | - | Speech recognition | Audio | Text |
| Gemini 3.5 Transcribe Live<br><code>gemini-3-5-transcribe-live</code> | google | - | - | Speech recognition | Audio | Text |
| Lyria 3 Clip Preview<br><code>lyria-3-clip-preview</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | Image recognition, Speech generation, Structured output, File input | Text, Image | Text, Audio |
| Lyria 3 Pro Preview<br><code>lyria-3-pro-preview</code> | google | <span title="1,048,576">1.05M</span> | <span title="65,536">64K</span> | Image recognition, Speech generation, Structured output, File input | Text, Image | Text, Audio |
| Voxtral Mini (latest)<br><code>voxtral-mini-latest</code> | mistral | - | - | Speech recognition | Audio | Text |
| Voxtral Mini TTS (latest)<br><code>voxtral-mini-tts-latest</code> | mistral | - | - | Speech generation | Text | Audio |
| magpie-tts-zeroshot<br><code>magpie-tts-zeroshot</code> | nvidia | - | <span title="4,096">4K</span> | Speech recognition, Speech generation, File input | Text, Audio | Audio |
| Whisper Large v3<br><code>whisper-large-v3</code> | nvidia | - | <span title="4,096">4K</span> | Speech recognition | Audio | Text |
| GPT-4o mini Transcribe<br><code>gpt-4o-mini-transcribe</code> | openai | - | - | Speech recognition | Audio | Text |
| GPT-4o Transcribe<br><code>gpt-4o-transcribe</code> | openai | - | - | Speech recognition | Audio | Text |
| GPT-Realtime mini<br><code>gpt-realtime-mini</code> | openai | - | - | Speech recognition, Speech generation | Text, Audio | Text, Audio |
| GPT-Realtime-1.5<br><code>gpt-realtime-1-5</code> | openai | - | - | Speech recognition, Speech generation | Text, Audio | Text, Audio |
| gpt-realtime-2<br><code>gpt-realtime-2</code> | openai | - | - | Speech recognition, Speech generation | Text, Audio | Text, Audio |
| gpt-realtime-2.1<br><code>gpt-realtime-2-1</code> | openai | <span title="128,000">128K</span> | <span title="32,000">32K</span> | Function calling, Reasoning, Image recognition, Speech recognition, Speech generation, File input | Text, Image, Audio | Text, Audio |
| gpt-realtime-whisper<br><code>gpt-realtime-whisper</code> | openai | - | - | Speech recognition | Audio | Text |
| OpenAI: GPT Audio<br><code>gpt-audio</code> | openai | <span title="128,000">128K</span> | - | Function calling, Speech recognition, Speech generation, Structured output | Text, Audio | Text, Audio |
| OpenAI: GPT Audio Mini<br><code>gpt-audio-mini</code> | openai | <span title="128,000">128K</span> | - | Function calling, Speech recognition, Speech generation, Structured output | Text, Audio | Text, Audio |
| Step TTS 2<br><code>step-tts-2</code> | stepfun | - | - | Speech generation | Text | Audio |
| StepAudio 2.5 ASR<br><code>stepaudio-2-5-asr</code> | stepfun | - | - | Speech recognition | Audio | Text |
| StepAudio 2.5 TTS<br><code>stepaudio-2-5-tts</code> | stepfun | - | - | Speech generation | Text | Audio |
| Suno v3<br><code>suno-v3</code> | suno | - | - | Speech generation | Text | Audio |
| Suno v3.5<br><code>suno-v3-5</code> | suno | - | - | Speech generation | Text | Audio |
| Suno v4<br><code>suno-v4</code> | suno | - | - | Speech generation | Text | Audio |
| Suno v4.5<br><code>suno-v4-5</code> | suno | - | - | Speech generation | Text | Audio |
| S1 (Free)<br><code>s1</code> | vercel | - | - | Speech generation | Text | Audio |
| S2 Pro<br><code>s2-pro</code> | vercel | - | - | Speech generation | Text | Audio |
| S2.1 Pro (Free)<br><code>s2-1-pro</code> | vercel | - | - | Speech generation | Text | Audio |
| Transcribe-1<br><code>transcribe-1</code> | vercel | - | - | Speech recognition | Audio | Text |
| TTS-1<br><code>tts-1</code> | vercel | - | - | Speech generation | Text | Audio |
| TTS-1 HD<br><code>tts-1-hd</code> | vercel | - | - | Speech generation | Text | Audio |
| Whisper<br><code>whisper-1</code> | vercel | - | - | Speech recognition | Audio | Text |
| Grok STT<br><code>grok-stt</code> | xai | - | - | Speech recognition | Audio | Text |
| Grok TTS<br><code>grok-tts</code> | xai | - | - | Speech generation | Text | Audio |
| Grok Voice Think Fast 1.0<br><code>grok-voice-think-fast-1-0</code> | xai | - | - | Speech recognition, Speech generation | Text, Audio | Text, Audio |
| Grok Voice Think Fast 2.0<br><code>grok-voice-think-fast-2-0</code> | xai | - | - | Speech recognition, Speech generation | Text, Audio | Text, Audio |

</div>

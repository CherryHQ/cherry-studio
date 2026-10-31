# Video Generation

Data comes from the model catalog bundled with Cherry Studio ([provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)), synced automatically with the application repository; a `-` means the source data does not provide that field.

Context length and max output are abbreviated with K / M and rounded (1K is roughly 1,000–1,024 tokens, 1M roughly one million), e.g. 131,072 and 128,000 both read 128K. Hover a value to see the exact number; confirm limits with the model provider.

> **Data updated**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (Beijing time)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:Reasoning,Image recognition,Speech recognition,Video understanding,File input;in:5:Image input=Image,Audio input=Audio,Video input=Video;out:6:Text output=Text">

| Model | Provider | Context | Max output | Capabilities | Input modalities | Output modalities |
| --- | --- | --- | --- | --- | --- | --- |
| Flux 3<br><code>flux-3-video</code> | black-forest-labs | - | - | Video generation | Text | Video |
| Doubao Seedance 1.0 Lite I2V<br><code>doubao-seedance-1-0-lite-i2v</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Doubao Seedance 1.0 Lite T2V<br><code>doubao-seedance-1-0-lite-t2v</code> | bytedance | - | - | Video generation | Text | Video |
| Doubao Seedance 1.0 Pro<br><code>doubao-seedance-1-0-pro</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Doubao Seedance 1.0 Pro Fast<br><code>doubao-seedance-1-0-pro-fast</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Doubao Seedance 2.0<br><code>doubao-seedance-2-0</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image, Audio, Video | Video |
| Doubao Seedance 2.0 Fast<br><code>doubao-seedance-2-0-fast</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image, Audio, Video | Video |
| Doubao Seedance 2.0 Mini<br><code>doubao-seedance-2-0-mini</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image, Video | Video |
| Seedance 2.0<br><code>seedance-2-0</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Seedance 2.0 Fast<br><code>seedance-2-0-fast</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Seedance 2.0 Mini<br><code>seedance-2-0-mini</code> | bytedance | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Seedance 2.5<br><code>seedance-2-5</code> | bytedance | - | - | Video generation | Text | Video |
| Seedance v1.0 Pro<br><code>seedance-v1-0-pro</code> | bytedance | - | - | Video generation | Text | Video |
| Seedance v1.0 Pro Fast<br><code>seedance-v1-0-pro-fast</code> | bytedance | - | - | Video generation | Text | Video |
| Seedance v1.5 Pro<br><code>seedance-v1-5-pro</code> | bytedance | - | - | Video generation | Text | Video |
| Gemini Omni 1.1 Flash<br><code>gemini-omni-1-1-flash</code> | google | <span title="1,048,576">1.05M</span> | - | Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Video |
| Gemini Omni Flash Preview<br><code>gemini-omni-flash-preview</code> | google | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | Reasoning, Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Text, Video |
| Veo 3.1<br><code>veo-3-1-generate-preview</code> | google | 480 | - | Image recognition, Video generation, File input | Text, Image | Video |
| Veo 3.1 fast<br><code>veo-3-1-fast-generate-preview</code> | google | 480 | - | Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Video |
| Veo 3.1 lite<br><code>veo-3-1-lite-generate-preview</code> | google | 480 | - | Image recognition, Video generation, File input | Text, Image | Video |
| Kling v1<br><code>kling-v1</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v1.5<br><code>kling-v1-5</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v1.6<br><code>kling-v1-6</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v2 Master<br><code>kling-v2-master</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v2.1<br><code>kling-v2-1</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v2.1 Master<br><code>kling-v2-1-master</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v2.5 Turbo<br><code>kling-v2-5-turbo</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v2.5 Turbo Image-to-Video<br><code>kling-v2-5-turbo-i2v</code> | kling | - | - | Video generation | Text | Video |
| Kling v2.5 Turbo Text-to-Video<br><code>kling-v2-5-turbo-t2v</code> | kling | - | - | Video generation | Text | Video |
| Kling v2.6<br><code>kling-v2-6</code> | kling | - | - | Video generation | Text, Image | Video |
| Kling v2.6 Image-to-Video<br><code>kling-v2-6-i2v</code> | kling | - | - | Video generation | Text | Video |
| Kling v2.6 Motion Control<br><code>kling-v2-6-motion-control</code> | kling | - | - | Video generation | Text | Video |
| Kling v2.6 Text-to-Video<br><code>kling-v2-6-t2v</code> | kling | - | - | Video generation | Text | Video |
| Kling v3.0 Image-to-Video<br><code>kling-v3-0-i2v</code> | kling | - | - | Video generation | Text | Video |
| Kling v3.0 Motion Control<br><code>kling-v3-0-motion-control</code> | kling | - | - | Video generation | Text | Video |
| Kling v3.0 Text-to-Video<br><code>kling-v3-0-t2v</code> | kling | - | - | Video generation | Text | Video |
| MiniMax H3<br><code>minimax-h3</code> | minimax | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| MiniMax H3 Max<br><code>minimax-h3-max</code> | minimax | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| cosmos-predict1-5b<br><code>cosmos-predict1-5b</code> | nvidia | - | <span title="4,096">4K</span> | Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Video |
| cosmos-transfer1-7b<br><code>cosmos-transfer1-7b</code> | nvidia | - | <span title="4,096">4K</span> | Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Video |
| cosmos-transfer2.5-2b<br><code>cosmos-transfer2-5-2b</code> | nvidia | - | <span title="4,096">4K</span> | Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Video |
| Runway Aleph<br><code>runway-aleph</code> | runway | - | - | Video generation | Text, Image | Video |
| Runway Gen-3 Alpha Turbo<br><code>runway-gen-3a-turbo</code> | runway | - | - | Video generation | Text, Image | Video |
| Runway Gen-4 Turbo<br><code>runway-gen-4-turbo</code> | runway | - | - | Video generation | Text, Image | Video |
| Veo 3.0<br><code>veo-3-0-generate-001</code> | vercel | - | - | Video generation | Text | Video |
| Veo 3.0 Fast Generate<br><code>veo-3-0-fast-generate-001</code> | vercel | - | - | Video generation | Text | Video |
| Veo 3.1<br><code>veo-3-1-generate-001</code> | vercel | - | - | Video generation | Text | Video |
| Veo 3.1 Fast Generate<br><code>veo-3-1-fast-generate-001</code> | vercel | - | - | Video generation | Text | Video |
| Veo 3.1 Lite Generate<br><code>veo-3-1-lite-generate-001</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.5 Text-to-Video Preview<br><code>wan-v2-5-t2v-preview</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.6 Image-to-Video<br><code>wan-v2-6-i2v</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.6 Image-to-Video Flash<br><code>wan-v2-6-i2v-flash</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.6 Reference-to-Video<br><code>wan-v2-6-r2v</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.6 Reference-to-Video Flash<br><code>wan-v2-6-r2v-flash</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.6 Text-to-Video<br><code>wan-v2-6-t2v</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.7 Reference-to-Video<br><code>wan-v2-7-r2v</code> | vercel | - | - | Video generation | Text | Video |
| Wan v2.7 Text-to-Video<br><code>wan-v2-7-t2v</code> | vercel | - | - | Video generation | Text | Video |
| Wan v3.0 Video<br><code>wan-v3-0-video</code> | vercel | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Wan v3.0 Video Prime<br><code>wan-v3-0-video-prime</code> | vercel | - | - | Image recognition, Video generation, File input | Text, Image | Video |
| Vidu Q3 Pro<br><code>viduq3-pro</code> | vidu | - | - | Video generation | Text, Image | Video |
| Vidu Q3 Pro Fast<br><code>viduq3-pro-fast</code> | vidu | - | - | Video generation | Text, Image | Video |
| Vidu Q3 Turbo<br><code>viduq3-turbo</code> | vidu | - | - | Video generation | Text, Image | Video |
| Grok Imagine<br><code>grok-imagine-video</code> | xai | <span title="1,024">1K</span> | - | Image recognition, Video understanding, Video generation, File input | Text, Image, Video | Video |
| Grok Imagine Video 1.5<br><code>grok-imagine-video-1-5</code> | xai | <span title="1,024">1K</span> | - | Image recognition, Speech recognition, Video generation, File input | Text, Image, Audio | Video |

</div>

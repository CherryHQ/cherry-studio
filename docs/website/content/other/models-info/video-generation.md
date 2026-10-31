# 视频生成

数据来自 Cherry Studio 内置模型目录（[provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)），随应用仓库自动同步；表中 `-` 表示数据源未提供该字段。

上下文长度与最大输出以 K / M 缩写并四舍五入（1K 约为 1,000～1,024 tokens，1M 约为 100 万 tokens），例如 131,072 与 128,000 均写作 128K。悬停可查看完整数值，精确限制请以模型服务商为准。

> **数据更新时间**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (北京时间)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:推理,识图,语音识别,视频理解,文件输入;in:5:图片输入=图片,音频输入=音频,视频输入=视频;out:6:文本输出=文本">

| 模型名称 | 服务商 | 上下文长度 | 最大输出 | 能力 | 输入模态 | 输出模态 |
| --- | --- | --- | --- | --- | --- | --- |
| Flux 3<br><code>flux-3-video</code> | black-forest-labs | - | - | 视频生成 | 文本 | 视频 |
| Doubao Seedance 1.0 Lite I2V<br><code>doubao-seedance-1-0-lite-i2v</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Doubao Seedance 1.0 Lite T2V<br><code>doubao-seedance-1-0-lite-t2v</code> | bytedance | - | - | 视频生成 | 文本 | 视频 |
| Doubao Seedance 1.0 Pro<br><code>doubao-seedance-1-0-pro</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Doubao Seedance 1.0 Pro Fast<br><code>doubao-seedance-1-0-pro-fast</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Doubao Seedance 2.0<br><code>doubao-seedance-2-0</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片、音频、视频 | 视频 |
| Doubao Seedance 2.0 Fast<br><code>doubao-seedance-2-0-fast</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片、音频、视频 | 视频 |
| Doubao Seedance 2.0 Mini<br><code>doubao-seedance-2-0-mini</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| Seedance 2.0<br><code>seedance-2-0</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Seedance 2.0 Fast<br><code>seedance-2-0-fast</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Seedance 2.0 Mini<br><code>seedance-2-0-mini</code> | bytedance | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Seedance 2.5<br><code>seedance-2-5</code> | bytedance | - | - | 视频生成 | 文本 | 视频 |
| Seedance v1.0 Pro<br><code>seedance-v1-0-pro</code> | bytedance | - | - | 视频生成 | 文本 | 视频 |
| Seedance v1.0 Pro Fast<br><code>seedance-v1-0-pro-fast</code> | bytedance | - | - | 视频生成 | 文本 | 视频 |
| Seedance v1.5 Pro<br><code>seedance-v1-5-pro</code> | bytedance | - | - | 视频生成 | 文本 | 视频 |
| Gemini Omni 1.1 Flash<br><code>gemini-omni-1-1-flash</code> | google | <span title="1,048,576">1.05M</span> | - | 识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| Gemini Omni Flash Preview<br><code>gemini-omni-flash-preview</code> | google | <span title="1,000,000">1M</span> | <span title="65,536">64K</span> | 推理、识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 文本、视频 |
| Veo 3.1<br><code>veo-3-1-generate-preview</code> | google | 480 | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Veo 3.1 fast<br><code>veo-3-1-fast-generate-preview</code> | google | 480 | - | 识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| Veo 3.1 lite<br><code>veo-3-1-lite-generate-preview</code> | google | 480 | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Kling v1<br><code>kling-v1</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v1.5<br><code>kling-v1-5</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v1.6<br><code>kling-v1-6</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v2 Master<br><code>kling-v2-master</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v2.1<br><code>kling-v2-1</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v2.1 Master<br><code>kling-v2-1-master</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v2.5 Turbo<br><code>kling-v2-5-turbo</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v2.5 Turbo Image-to-Video<br><code>kling-v2-5-turbo-i2v</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v2.5 Turbo Text-to-Video<br><code>kling-v2-5-turbo-t2v</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v2.6<br><code>kling-v2-6</code> | kling | - | - | 视频生成 | 文本、图片 | 视频 |
| Kling v2.6 Image-to-Video<br><code>kling-v2-6-i2v</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v2.6 Motion Control<br><code>kling-v2-6-motion-control</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v2.6 Text-to-Video<br><code>kling-v2-6-t2v</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v3.0 Image-to-Video<br><code>kling-v3-0-i2v</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v3.0 Motion Control<br><code>kling-v3-0-motion-control</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| Kling v3.0 Text-to-Video<br><code>kling-v3-0-t2v</code> | kling | - | - | 视频生成 | 文本 | 视频 |
| MiniMax H3<br><code>minimax-h3</code> | minimax | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| MiniMax H3 Max<br><code>minimax-h3-max</code> | minimax | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| cosmos-predict1-5b<br><code>cosmos-predict1-5b</code> | nvidia | - | <span title="4,096">4K</span> | 识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| cosmos-transfer1-7b<br><code>cosmos-transfer1-7b</code> | nvidia | - | <span title="4,096">4K</span> | 识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| cosmos-transfer2.5-2b<br><code>cosmos-transfer2-5-2b</code> | nvidia | - | <span title="4,096">4K</span> | 识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| Runway Aleph<br><code>runway-aleph</code> | runway | - | - | 视频生成 | 文本、图片 | 视频 |
| Runway Gen-3 Alpha Turbo<br><code>runway-gen-3a-turbo</code> | runway | - | - | 视频生成 | 文本、图片 | 视频 |
| Runway Gen-4 Turbo<br><code>runway-gen-4-turbo</code> | runway | - | - | 视频生成 | 文本、图片 | 视频 |
| Veo 3.0<br><code>veo-3-0-generate-001</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Veo 3.0 Fast Generate<br><code>veo-3-0-fast-generate-001</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Veo 3.1<br><code>veo-3-1-generate-001</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Veo 3.1 Fast Generate<br><code>veo-3-1-fast-generate-001</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Veo 3.1 Lite Generate<br><code>veo-3-1-lite-generate-001</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.5 Text-to-Video Preview<br><code>wan-v2-5-t2v-preview</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.6 Image-to-Video<br><code>wan-v2-6-i2v</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.6 Image-to-Video Flash<br><code>wan-v2-6-i2v-flash</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.6 Reference-to-Video<br><code>wan-v2-6-r2v</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.6 Reference-to-Video Flash<br><code>wan-v2-6-r2v-flash</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.6 Text-to-Video<br><code>wan-v2-6-t2v</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.7 Reference-to-Video<br><code>wan-v2-7-r2v</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v2.7 Text-to-Video<br><code>wan-v2-7-t2v</code> | vercel | - | - | 视频生成 | 文本 | 视频 |
| Wan v3.0 Video<br><code>wan-v3-0-video</code> | vercel | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Wan v3.0 Video Prime<br><code>wan-v3-0-video-prime</code> | vercel | - | - | 识图、视频生成、文件输入 | 文本、图片 | 视频 |
| Vidu Q3 Pro<br><code>viduq3-pro</code> | vidu | - | - | 视频生成 | 文本、图片 | 视频 |
| Vidu Q3 Pro Fast<br><code>viduq3-pro-fast</code> | vidu | - | - | 视频生成 | 文本、图片 | 视频 |
| Vidu Q3 Turbo<br><code>viduq3-turbo</code> | vidu | - | - | 视频生成 | 文本、图片 | 视频 |
| Grok Imagine<br><code>grok-imagine-video</code> | xai | <span title="1,024">1K</span> | - | 识图、视频理解、视频生成、文件输入 | 文本、图片、视频 | 视频 |
| Grok Imagine Video 1.5<br><code>grok-imagine-video-1-5</code> | xai | <span title="1,024">1K</span> | - | 识图、语音识别、视频生成、文件输入 | 文本、图片、音频 | 视频 |

</div>

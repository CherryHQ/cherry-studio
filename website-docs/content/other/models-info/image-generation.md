# 图像生成

数据来自 Cherry Studio 内置模型目录（[provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)），随应用仓库自动同步；表中 `-` 表示数据源未提供该字段。

上下文长度与最大输出以 K / M 缩写并四舍五入（1K 约为 1,000～1,024 tokens，1M 约为 100 万 tokens），例如 131,072 与 128,000 均写作 128K。悬停可查看完整数值，精确限制请以模型服务商为准。

> **数据更新时间**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (北京时间)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:函数调用,推理,识图,语音识别,视频理解,结构化输出,文件输入;in:5:图片输入=图片,音频输入=音频,视频输入=视频;out:6:文本输出=文本">

| 模型名称 | 服务商 | 上下文长度 | 最大输出 | 能力 | 输入模态 | 输出模态 |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen Image<br><code>qwen-image</code> | alibaba | - | - | 图片生成 | 文本 | 图片 |
| Qwen Image 3.0<br><code>qwen-image-3-0</code> | alibaba | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Qwen Image 3.0 Pro<br><code>qwen-image-3-0-pro</code> | alibaba | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Qwen Image Edit<br><code>qwen-image-edit</code> | alibaba | - | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| Qwen: Qwen Image 3<br><code>qwen-image-3</code> | alibaba | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Qwen: Qwen Image 3 Pro<br><code>qwen-image-3-pro</code> | alibaba | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| wan2-6-t2i<br><code>wan2-6-t2i</code> | alibaba | - | - | 图片生成 | 文本 | 图片 |
| wan2.6-image<br><code>wan2-6-image</code> | alibaba | - | - | 图片生成 | 文本、图片 | - |
| wan2.7-image<br><code>wan2-7-image</code> | alibaba | - | - | 图片生成 | 文本 | 图片 |
| wan2.7-image-pro<br><code>wan2-7-image-pro</code> | alibaba | - | - | 图片生成 | 文本 | 图片 |
| Flux 2 Flex<br><code>flux-2-flex</code> | black-forest-labs | - | - | 图片生成 | 文本 | 图片 |
| Flux 2 Pro<br><code>flux-2-pro</code> | black-forest-labs | <span title="67,300">67.3K</span> | <span title="67,300">67.3K</span> | 图片生成 | 文本 | 图片 |
| Flux Schnell<br><code>flux-fast-schnell</code> | black-forest-labs | 512 | - | 图片生成 | 文本 | 图片 |
| FLUX.1 Dev<br><code>flux-dev</code> | black-forest-labs | - | - | 图片生成 | 文本 | 图片 |
| FLUX.1 Fill [pro]<br><code>flux-pro-1-0-fill</code> | black-forest-labs | 512 | - | 图片生成 | 文本 | 图片 |
| FLUX.1 Fill Pro<br><code>flux-fill-pro</code> | black-forest-labs | - | - | 图片生成 | 文本、图片 | 图片 |
| FLUX.1 Kontext Dev<br><code>flux-kontext-dev</code> | black-forest-labs | - | - | 图片生成 | 文本、图片 | 图片 |
| FLUX.1 Kontext Max<br><code>flux-kontext-max</code> | black-forest-labs | 512 | - | 图片生成 | 文本 | 图片 |
| FLUX.1 Kontext Pro<br><code>flux-kontext-pro</code> | black-forest-labs | 512 | - | 图片生成 | 文本 | 图片 |
| FLUX.1 Pro<br><code>flux-pro</code> | black-forest-labs | - | - | 图片生成 | 文本 | 图片 |
| FLUX.1 Schnell<br><code>flux-schnell</code> | black-forest-labs | - | - | 图片生成 | 文本 | 图片 |
| FLUX.1-dev<br><code>flux-1-dev</code> | black-forest-labs | <span title="4,096">4K</span> | - | 图片生成 | 文本 | 图片 |
| FLUX.1-Kontext-dev<br><code>flux-1-kontext-dev</code> | black-forest-labs | <span title="40,960">40K</span> | <span title="40,960">40K</span> | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| FLUX.1-schnell<br><code>flux-1-schnell</code> | black-forest-labs | 77 | - | 图片生成 | 文本 | 图片 |
| FLUX.2 [klein] 9B<br><code>flux-2-klein-9b</code> | black-forest-labs | - | - | 图片生成 | 文本 | 图片 |
| FLUX.2 [max]<br><code>flux-2-max</code> | black-forest-labs | <span title="67,300">67.3K</span> | <span title="67,300">67.3K</span> | 识图、图片生成 | 文本、图片 | 图片 |
| FLUX.2 Klein 4B<br><code>flux-2-klein-4b</code> | black-forest-labs | <span title="40,960">40K</span> | <span title="40,960">40K</span> | 识图、图片生成 | 文本、图片 | 图片 |
| FLUX1.1 [pro]<br><code>flux-pro-1-1</code> | black-forest-labs | 512 | - | 图片生成 | 文本 | 图片 |
| FLUX1.1 [pro] Ultra<br><code>flux-pro-1-1-ultra</code> | black-forest-labs | 512 | - | 图片生成 | 文本 | 图片 |
| FLUX1.1 Pro Ultra<br><code>flux-1-1-pro-ultra</code> | black-forest-labs | - | - | 图片生成 | 文本 | 图片 |
| Bria Eraser<br><code>eraser</code> | bria | - | - | 图片生成 | 文本、图片 | 图片 |
| Bria Expand Image<br><code>expand-image</code> | bria | - | - | 图片生成 | 文本、图片 | 图片 |
| Bria FIBO<br><code>fibo</code> | bria | - | - | 图片生成 | 文本 | 图片 |
| Bria FIBO Edit<br><code>fibo-edit</code> | bria | - | - | 图片生成 | 文本、图片 | 图片 |
| Bria Generate Background<br><code>generate-background</code> | bria | - | - | 图片生成 | 文本、图片 | 图片 |
| Bria GenFill<br><code>genfill</code> | bria | - | - | 图片生成 | 文本、图片 | 图片 |
| Bria Image 3.2<br><code>image-3-2</code> | bria | - | - | 图片生成 | 文本 | 图片 |
| Doubao SeedEdit 3.0 I2I<br><code>doubao-seededit-3-0-i2i</code> | bytedance | - | - | 图片生成 | 文本、图片 | 图片 |
| Doubao Seedream 3.0 T2I<br><code>doubao-seedream-3-0-t2i</code> | bytedance | - | - | 图片生成 | 文本 | 图片 |
| Doubao Seedream 4 0<br><code>doubao-seedream-4-0</code> | bytedance | - | - | 图片生成 | 文本、图片 | 图片 |
| Doubao Seedream 4 5<br><code>doubao-seedream-4-5</code> | bytedance | - | - | 图片生成 | 文本、图片 | 图片 |
| Doubao Seedream 5.0 Lite<br><code>doubao-seedream-5-0-lite</code> | bytedance | - | - | 图片生成 | 文本、图片 | 图片 |
| Doubao Seedream 5.0 Pro<br><code>doubao-seedream-5-0-pro</code> | bytedance | - | - | 图片生成 | 文本、图片 | 图片 |
| Seedream 4.0<br><code>seedream-4-0</code> | bytedance | - | - | 图片生成 | 文本 | 图片 |
| Seedream 4.5<br><code>seedream-4-5</code> | bytedance | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Seedream 5.0 Lite<br><code>seedream-5-0-lite</code> | bytedance | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Seedream 5.0 Pro<br><code>seedream-5-0-pro</code> | bytedance | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Deep Research Max Preview (Apr-21-2026)<br><code>deep-research-max-preview-04-2026</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、图片生成、语音识别、视频理解、文件输入 | 文本、图片、音频、视频 | 文本、图片 |
| Deep Research Preview (Apr-21-2026)<br><code>deep-research-preview-04-2026</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、图片生成、语音识别、视频理解、文件输入 | 文本、图片、音频、视频 | 文本、图片 |
| gemini-2.5-flash-image<br><code>gemini-2-5-flash-image</code> | google | <span title="32,768">32K</span> | - | 推理、识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| gemini-3-pro-image-preview<br><code>gemini-3-pro-image-preview</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 推理、识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)<br><code>gemini-3-1-flash-image-preview</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 推理、识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| Imagen 4<br><code>imagen-4-0-generate-001</code> | google | - | - | 图片生成 | 文本 | 图片 |
| Imagen 4 0<br><code>imagen-4-0</code> | google | - | - | 图片生成 | 文本、图片 | 图片 |
| Imagen 4 0 Fast Generate Preview 06 06<br><code>imagen-4-0-fast-generate-preview-06-06</code> | google | - | - | 图片生成 | 文本、图片 | 图片 |
| Imagen 4 0 Ultra<br><code>imagen-4-0-ultra</code> | google | - | - | 图片生成 | 文本 | 图片 |
| Imagen 4 Fast<br><code>imagen-4-0-fast-generate-001</code> | google | - | - | 图片生成 | 文本 | 图片 |
| Imagen 4 Ultra<br><code>imagen-4-0-ultra-generate-001</code> | google | - | - | 图片生成 | 文本 | 图片 |
| Imagen 4.0 Preview<br><code>imagen-4-0-generate-preview-06-06</code> | google | - | - | 图片生成 | 文本 | 图片 |
| Imagen 4.0 Ultra Preview<br><code>imagen-4-0-ultra-generate-preview-06-06</code> | google | - | - | 图片生成 | 文本 | 图片 |
| Imagen-3<br><code>imagen-3</code> | google | - | - | 函数调用、图片生成、文件输入 | 文本 | 图片 |
| Imagen-3-Fast<br><code>imagen-3-fast</code> | google | - | - | 函数调用、图片生成、文件输入 | 文本 | 图片 |
| Imagen-4<br><code>imagen-4</code> | google | - | - | 函数调用、文件输入、图片生成 | 文本 | 图片 |
| Imagen-4-Fast<br><code>imagen-4-fast</code> | google | - | - | 函数调用、文件输入、图片生成 | 文本 | 图片 |
| Imagen-4-Ultra<br><code>imagen-4-ultra</code> | google | - | - | 函数调用、文件输入、图片生成 | 文本 | 图片 |
| Nano Banana 2<br><code>gemini-3-1-flash-image</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | 推理、识图、图片生成、视频理解、结构化输出、文件输入 | 文本、图片、视频 | 文本、图片 |
| Nano Banana 2 Lite<br><code>gemini-3-1-flash-lite-image</code> | google | <span title="65,536">64K</span> | <span title="65,536">64K</span> | 函数调用、推理、识图、图片生成、结构化输出、文件输入 | 文本、图片 | 文本、图片 |
| Nano Banana 2.1<br><code>gemini-nano-banana-2-1</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 推理、识图、图片生成、视频理解、文件输入 | 文本、图片、视频 | 文本、图片 |
| Nano Banana Preview (Gemini 2.5 Flash Image Preview)<br><code>gemini-2-5-flash-image-preview</code> | google | - | - | 推理、识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| Nano Banana Pro<br><code>nano-banana-pro-preview</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 推理、识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| Nano Banana Pro (Gemini 3 Pro Image)<br><code>gemini-3-pro-image</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | 函数调用、推理、识图、图片生成、结构化输出、文件输入 | 文本、图片 | 文本、图片 |
| Ideogram v2<br><code>ideogram-v2</code> | ideogram | - | - | 图片生成 | 文本 | 图片 |
| Ideogram v2a<br><code>ideogram-v2a</code> | ideogram | - | - | 图片生成 | 文本 | 图片 |
| Ideogram v2a Turbo<br><code>ideogram-v2a-turbo</code> | ideogram | - | - | 图片生成 | 文本 | 图片 |
| Ideogram v3<br><code>ideogram-v3</code> | ideogram | - | - | 图片生成 | 文本 | 图片 |
| Ideogram v4<br><code>ideogram-v4</code> | ideogram | - | - | 图片生成 | 文本 | 图片 |
| Kolors<br><code>kolors</code> | kling | - | - | 图片生成 | 文本 | 图片 |
| Luma Photon<br><code>photon</code> | luma | - | - | 图片生成 | 文本 | 图片 |
| Luma Photon Flash<br><code>photon-flash</code> | luma | - | - | 图片生成 | 文本 | 图片 |
| MicrosoftAI: MAI-Image-2.5<br><code>mai-image-2-5</code> | microsoft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| MicrosoftAI: MAI-Image-2.5 Pro<br><code>mai-image-2-5-pro</code> | microsoft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| MicrosoftAI: MAI-Image-2.6<br><code>mai-image-2-6</code> | microsoft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| MicrosoftAI: MAI-Image-2.6 Flash<br><code>mai-image-2-6-flash</code> | microsoft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| image-01<br><code>image-01</code> | minimax | - | - | 图片生成 | 文本、图片 | 图片 |
| image-01-live<br><code>image-01-live</code> | minimax | - | - | 图片生成 | 文本、图片 | 图片 |
| chatgpt-image-latest<br><code>chatgpt-image-latest</code> | openai | - | - | 识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| Dall E 2<br><code>dall-e-2</code> | openai | - | - | 图片生成 | 文本、图片 | 图片 |
| DALL-E-3<br><code>dall-e-3</code> | openai | - | - | 函数调用、图片生成、文件输入 | 文本 | 图片 |
| GPT Image 1.5<br><code>gpt-image-1-5</code> | openai | - | - | 识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| GPT Image 2.5 Flare<br><code>gpt-image-2-5-flare</code> | openai | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| GPT Image 2.5 Sunburst<br><code>gpt-image-2-5-sunburst</code> | openai | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| GPT-Image-1<br><code>gpt-image-1</code> | openai | - | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| GPT-Image-1-Mini<br><code>gpt-image-1-mini</code> | openai | - | - | 识图、图片生成、文件输入 | 文本、图片 | 文本、图片 |
| GPT-Image-2<br><code>gpt-image-2</code> | openai | - | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| OpenAI: GPT-5 Image<br><code>gpt-5-image</code> | openai | <span title="400,000">400K</span> | - | 推理、识图、图片生成、结构化输出、文件输入 | 文本、图片 | 文本、图片 |
| OpenAI: GPT-5 Image Mini<br><code>gpt-5-image-mini</code> | openai | <span title="400,000">400K</span> | - | 推理、识图、图片生成、结构化输出、文件输入 | 文本、图片 | 文本、图片 |
| Recraft V2<br><code>recraft-v2</code> | recraft | 512 | - | 图片生成 | 文本 | 图片 |
| Recraft V3<br><code>recraft-v3</code> | recraft | 512 | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft V4<br><code>recraft-v4</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft V4 Pro<br><code>recraft-v4-pro</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft V4.1<br><code>recraft-v4-1</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft V4.1 Pro<br><code>recraft-v4-1-pro</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft V4.1 Utility<br><code>recraft-v4-1-utility</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft V4.1 Utility Pro<br><code>recraft-v4-1-utility-pro</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4 Pro Vector<br><code>recraft-v4-pro-vector</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4 Styles<br><code>recraft-v4-styles</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4 Styles Pro<br><code>recraft-v4-styles-pro</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4 Styles Pro Vector<br><code>recraft-v4-styles-pro-vector</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4 Styles Vector<br><code>recraft-v4-styles-vector</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4 Vector<br><code>recraft-v4-vector</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4.1 Pro Vector<br><code>recraft-v4-1-pro-vector</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Recraft: Recraft V4.1 Vector<br><code>recraft-v4-1-vector</code> | recraft | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Sourceful: Riverflow V2 Fast<br><code>riverflow-v2-fast</code> | sourceful | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Sourceful: Riverflow V2 Pro<br><code>riverflow-v2-pro</code> | sourceful | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Sourceful: Riverflow V2.5 Fast<br><code>riverflow-v2-5-fast</code> | sourceful | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Sourceful: Riverflow V2.5 Pro<br><code>riverflow-v2-5-pro</code> | sourceful | - | - | 识图、图片生成 | 文本、图片 | 图片 |
| Stable Diffusion 3<br><code>stable-diffusion-3</code> | stability | - | - | 图片生成 | 文本 | 图片 |
| Stable Diffusion 3.5 Large<br><code>stable-diffusion-3-5-large</code> | stability | - | - | 图片生成 | 文本 | 图片 |
| Stable Diffusion 3.5 Large Turbo<br><code>stable-diffusion-3-5-large-turbo</code> | stability | - | - | 图片生成 | 文本 | 图片 |
| Stable Diffusion v1.4<br><code>stable-diffusion-v1-4</code> | stability | - | - | 图片生成 | 文本 | 图片 |
| Stable Diffusion v1.5<br><code>stable-diffusion-v1-5</code> | stability | - | - | 图片生成 | 文本 | 图片 |
| Stable Diffusion XL Base 1.0<br><code>stable-diffusion-xl-base-1-0</code> | stability | - | - | 图片生成 | 文本 | 图片 |
| Hunyuan Image 3.0<br><code>hy-image-v3-0</code> | tencent | - | - | 图片生成 | 文本、图片 | 图片 |
| Hunyuan Image Lite<br><code>hy-image-lite</code> | tencent | - | - | 图片生成 | 文本 | 图片 |
| Arrow 1.1<br><code>arrow-1-1</code> | vercel | <span title="131,072">128K</span> | <span title="131,072">128K</span> | 图片生成 | 文本 | 图片 |
| Muse Image 1.0<br><code>muse-image-1-0</code> | vercel | - | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| Vidu Q1<br><code>viduq1</code> | vidu | - | - | 图片生成 | 文本 | 图片 |
| Vidu Q2<br><code>viduq2</code> | vidu | - | - | 图片生成 | 文本 | 图片 |
| Grok Imagine Image<br><code>grok-imagine-image</code> | xai | <span title="16,000">16K</span> | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| Grok Imagine Image 2.0<br><code>grok-imagine-image-2-0</code> | xai | <span title="64,000">64K</span> | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| Grok Imagine Image Quality<br><code>grok-imagine-image-quality</code> | xai | <span title="16,000">16K</span> | - | 识图、图片生成、文件输入 | 文本、图片 | 图片 |
| cogview-4<br><code>cogview-4</code> | zhipu | - | - | 图片生成 | - | - |
| glm-image<br><code>glm-image</code> | zhipu | - | - | 图片生成 | 文本 | 图片 |

</div>

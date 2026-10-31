# Image Generation

Data comes from the model catalog bundled with Cherry Studio ([provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)), synced automatically with the application repository; a `-` means the source data does not provide that field.

Context length and max output are abbreviated with K / M and rounded (1K is roughly 1,000–1,024 tokens, 1M roughly one million), e.g. 131,072 and 128,000 both read 128K. Hover a value to see the exact number; confirm limits with the model provider.

> **Data updated**: 2026-10-27 14:14:54 UTC / 2026-10-27 22:14:54 CST (Beijing time)

<div data-models-table="num:2,3;sort:1;search:0,1;cap:4:Function calling,Reasoning,Image recognition,Speech recognition,Video understanding,Structured output,File input;in:5:Image input=Image,Audio input=Audio,Video input=Video;out:6:Text output=Text">

| Model | Provider | Context | Max output | Capabilities | Input modalities | Output modalities |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen Image<br><code>qwen-image</code> | alibaba | - | - | Image generation | Text | Image |
| Qwen Image 3.0<br><code>qwen-image-3-0</code> | alibaba | - | - | Image recognition, Image generation | Text, Image | Image |
| Qwen Image 3.0 Pro<br><code>qwen-image-3-0-pro</code> | alibaba | - | - | Image recognition, Image generation | Text, Image | Image |
| Qwen Image Edit<br><code>qwen-image-edit</code> | alibaba | - | - | Image recognition, Image generation, File input | Text, Image | Image |
| Qwen: Qwen Image 3<br><code>qwen-image-3</code> | alibaba | - | - | Image recognition, Image generation | Text, Image | Image |
| Qwen: Qwen Image 3 Pro<br><code>qwen-image-3-pro</code> | alibaba | - | - | Image recognition, Image generation | Text, Image | Image |
| wan2-6-t2i<br><code>wan2-6-t2i</code> | alibaba | - | - | Image generation | Text | Image |
| wan2.6-image<br><code>wan2-6-image</code> | alibaba | - | - | Image generation | Text, Image | - |
| wan2.7-image<br><code>wan2-7-image</code> | alibaba | - | - | Image generation | Text | Image |
| wan2.7-image-pro<br><code>wan2-7-image-pro</code> | alibaba | - | - | Image generation | Text | Image |
| Flux 2 Flex<br><code>flux-2-flex</code> | black-forest-labs | - | - | Image generation | Text | Image |
| Flux 2 Pro<br><code>flux-2-pro</code> | black-forest-labs | <span title="67,300">67.3K</span> | <span title="67,300">67.3K</span> | Image generation | Text | Image |
| Flux Schnell<br><code>flux-fast-schnell</code> | black-forest-labs | 512 | - | Image generation | Text | Image |
| FLUX.1 Dev<br><code>flux-dev</code> | black-forest-labs | - | - | Image generation | Text | Image |
| FLUX.1 Fill [pro]<br><code>flux-pro-1-0-fill</code> | black-forest-labs | 512 | - | Image generation | Text | Image |
| FLUX.1 Fill Pro<br><code>flux-fill-pro</code> | black-forest-labs | - | - | Image generation | Text, Image | Image |
| FLUX.1 Kontext Dev<br><code>flux-kontext-dev</code> | black-forest-labs | - | - | Image generation | Text, Image | Image |
| FLUX.1 Kontext Max<br><code>flux-kontext-max</code> | black-forest-labs | 512 | - | Image generation | Text | Image |
| FLUX.1 Kontext Pro<br><code>flux-kontext-pro</code> | black-forest-labs | 512 | - | Image generation | Text | Image |
| FLUX.1 Pro<br><code>flux-pro</code> | black-forest-labs | - | - | Image generation | Text | Image |
| FLUX.1 Schnell<br><code>flux-schnell</code> | black-forest-labs | - | - | Image generation | Text | Image |
| FLUX.1-dev<br><code>flux-1-dev</code> | black-forest-labs | <span title="4,096">4K</span> | - | Image generation | Text | Image |
| FLUX.1-Kontext-dev<br><code>flux-1-kontext-dev</code> | black-forest-labs | <span title="40,960">40K</span> | <span title="40,960">40K</span> | Image recognition, Image generation, File input | Text, Image | Image |
| FLUX.1-schnell<br><code>flux-1-schnell</code> | black-forest-labs | 77 | - | Image generation | Text | Image |
| FLUX.2 [klein] 9B<br><code>flux-2-klein-9b</code> | black-forest-labs | - | - | Image generation | Text | Image |
| FLUX.2 [max]<br><code>flux-2-max</code> | black-forest-labs | <span title="67,300">67.3K</span> | <span title="67,300">67.3K</span> | Image recognition, Image generation | Text, Image | Image |
| FLUX.2 Klein 4B<br><code>flux-2-klein-4b</code> | black-forest-labs | <span title="40,960">40K</span> | <span title="40,960">40K</span> | Image recognition, Image generation | Text, Image | Image |
| FLUX1.1 [pro]<br><code>flux-pro-1-1</code> | black-forest-labs | 512 | - | Image generation | Text | Image |
| FLUX1.1 [pro] Ultra<br><code>flux-pro-1-1-ultra</code> | black-forest-labs | 512 | - | Image generation | Text | Image |
| FLUX1.1 Pro Ultra<br><code>flux-1-1-pro-ultra</code> | black-forest-labs | - | - | Image generation | Text | Image |
| Bria Eraser<br><code>eraser</code> | bria | - | - | Image generation | Text, Image | Image |
| Bria Expand Image<br><code>expand-image</code> | bria | - | - | Image generation | Text, Image | Image |
| Bria FIBO<br><code>fibo</code> | bria | - | - | Image generation | Text | Image |
| Bria FIBO Edit<br><code>fibo-edit</code> | bria | - | - | Image generation | Text, Image | Image |
| Bria Generate Background<br><code>generate-background</code> | bria | - | - | Image generation | Text, Image | Image |
| Bria GenFill<br><code>genfill</code> | bria | - | - | Image generation | Text, Image | Image |
| Bria Image 3.2<br><code>image-3-2</code> | bria | - | - | Image generation | Text | Image |
| Doubao SeedEdit 3.0 I2I<br><code>doubao-seededit-3-0-i2i</code> | bytedance | - | - | Image generation | Text, Image | Image |
| Doubao Seedream 3.0 T2I<br><code>doubao-seedream-3-0-t2i</code> | bytedance | - | - | Image generation | Text | Image |
| Doubao Seedream 4 0<br><code>doubao-seedream-4-0</code> | bytedance | - | - | Image generation | Text, Image | Image |
| Doubao Seedream 4 5<br><code>doubao-seedream-4-5</code> | bytedance | - | - | Image generation | Text, Image | Image |
| Doubao Seedream 5.0 Lite<br><code>doubao-seedream-5-0-lite</code> | bytedance | - | - | Image generation | Text, Image | Image |
| Doubao Seedream 5.0 Pro<br><code>doubao-seedream-5-0-pro</code> | bytedance | - | - | Image generation | Text, Image | Image |
| Seedream 4.0<br><code>seedream-4-0</code> | bytedance | - | - | Image generation | Text | Image |
| Seedream 4.5<br><code>seedream-4-5</code> | bytedance | - | - | Image recognition, Image generation | Text, Image | Image |
| Seedream 5.0 Lite<br><code>seedream-5-0-lite</code> | bytedance | - | - | Image recognition, Image generation | Text, Image | Image |
| Seedream 5.0 Pro<br><code>seedream-5-0-pro</code> | bytedance | - | - | Image recognition, Image generation | Text, Image | Image |
| Deep Research Max Preview (Apr-21-2026)<br><code>deep-research-max-preview-04-2026</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | Function calling, Reasoning, Image recognition, Image generation, Speech recognition, Video understanding, File input | Text, Image, Audio, Video | Text, Image |
| Deep Research Preview (Apr-21-2026)<br><code>deep-research-preview-04-2026</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | Function calling, Reasoning, Image recognition, Image generation, Speech recognition, Video understanding, File input | Text, Image, Audio, Video | Text, Image |
| gemini-2.5-flash-image<br><code>gemini-2-5-flash-image</code> | google | <span title="32,768">32K</span> | - | Reasoning, Image recognition, Image generation, File input | Text, Image | Text, Image |
| gemini-3-pro-image-preview<br><code>gemini-3-pro-image-preview</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | Reasoning, Image recognition, Image generation, File input | Text, Image | Text, Image |
| Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)<br><code>gemini-3-1-flash-image-preview</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | Reasoning, Image recognition, Image generation, File input | Text, Image | Text, Image |
| Imagen 4<br><code>imagen-4-0-generate-001</code> | google | - | - | Image generation | Text | Image |
| Imagen 4 0<br><code>imagen-4-0</code> | google | - | - | Image generation | Text, Image | Image |
| Imagen 4 0 Fast Generate Preview 06 06<br><code>imagen-4-0-fast-generate-preview-06-06</code> | google | - | - | Image generation | Text, Image | Image |
| Imagen 4 0 Ultra<br><code>imagen-4-0-ultra</code> | google | - | - | Image generation | Text | Image |
| Imagen 4 Fast<br><code>imagen-4-0-fast-generate-001</code> | google | - | - | Image generation | Text | Image |
| Imagen 4 Ultra<br><code>imagen-4-0-ultra-generate-001</code> | google | - | - | Image generation | Text | Image |
| Imagen 4.0 Preview<br><code>imagen-4-0-generate-preview-06-06</code> | google | - | - | Image generation | Text | Image |
| Imagen 4.0 Ultra Preview<br><code>imagen-4-0-ultra-generate-preview-06-06</code> | google | - | - | Image generation | Text | Image |
| Imagen-3<br><code>imagen-3</code> | google | - | - | Function calling, Image generation, File input | Text | Image |
| Imagen-3-Fast<br><code>imagen-3-fast</code> | google | - | - | Function calling, Image generation, File input | Text | Image |
| Imagen-4<br><code>imagen-4</code> | google | - | - | Function calling, File input, Image generation | Text | Image |
| Imagen-4-Fast<br><code>imagen-4-fast</code> | google | - | - | Function calling, File input, Image generation | Text | Image |
| Imagen-4-Ultra<br><code>imagen-4-ultra</code> | google | - | - | Function calling, File input, Image generation | Text | Image |
| Nano Banana 2<br><code>gemini-3-1-flash-image</code> | google | <span title="131,072">128K</span> | <span title="65,536">64K</span> | Reasoning, Image recognition, Image generation, Video understanding, Structured output, File input | Text, Image, Video | Text, Image |
| Nano Banana 2 Lite<br><code>gemini-3-1-flash-lite-image</code> | google | <span title="65,536">64K</span> | <span title="65,536">64K</span> | Function calling, Reasoning, Image recognition, Image generation, Structured output, File input | Text, Image | Text, Image |
| Nano Banana 2.1<br><code>gemini-nano-banana-2-1</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | Reasoning, Image recognition, Image generation, Video understanding, File input | Text, Image, Video | Text, Image |
| Nano Banana Preview (Gemini 2.5 Flash Image Preview)<br><code>gemini-2-5-flash-image-preview</code> | google | - | - | Reasoning, Image recognition, Image generation, File input | Text, Image | Text, Image |
| Nano Banana Pro<br><code>nano-banana-pro-preview</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | Reasoning, Image recognition, Image generation, File input | Text, Image | Text, Image |
| Nano Banana Pro (Gemini 3 Pro Image)<br><code>gemini-3-pro-image</code> | google | <span title="131,072">128K</span> | <span title="32,768">32K</span> | Function calling, Reasoning, Image recognition, Image generation, Structured output, File input | Text, Image | Text, Image |
| Ideogram v2<br><code>ideogram-v2</code> | ideogram | - | - | Image generation | Text | Image |
| Ideogram v2a<br><code>ideogram-v2a</code> | ideogram | - | - | Image generation | Text | Image |
| Ideogram v2a Turbo<br><code>ideogram-v2a-turbo</code> | ideogram | - | - | Image generation | Text | Image |
| Ideogram v3<br><code>ideogram-v3</code> | ideogram | - | - | Image generation | Text | Image |
| Ideogram v4<br><code>ideogram-v4</code> | ideogram | - | - | Image generation | Text | Image |
| Kolors<br><code>kolors</code> | kling | - | - | Image generation | Text | Image |
| Luma Photon<br><code>photon</code> | luma | - | - | Image generation | Text | Image |
| Luma Photon Flash<br><code>photon-flash</code> | luma | - | - | Image generation | Text | Image |
| MicrosoftAI: MAI-Image-2.5<br><code>mai-image-2-5</code> | microsoft | - | - | Image recognition, Image generation | Text, Image | Image |
| MicrosoftAI: MAI-Image-2.5 Pro<br><code>mai-image-2-5-pro</code> | microsoft | - | - | Image recognition, Image generation | Text, Image | Image |
| MicrosoftAI: MAI-Image-2.6<br><code>mai-image-2-6</code> | microsoft | - | - | Image recognition, Image generation | Text, Image | Image |
| MicrosoftAI: MAI-Image-2.6 Flash<br><code>mai-image-2-6-flash</code> | microsoft | - | - | Image recognition, Image generation | Text, Image | Image |
| image-01<br><code>image-01</code> | minimax | - | - | Image generation | Text, Image | Image |
| image-01-live<br><code>image-01-live</code> | minimax | - | - | Image generation | Text, Image | Image |
| chatgpt-image-latest<br><code>chatgpt-image-latest</code> | openai | - | - | Image recognition, Image generation, File input | Text, Image | Text, Image |
| Dall E 2<br><code>dall-e-2</code> | openai | - | - | Image generation | Text, Image | Image |
| DALL-E-3<br><code>dall-e-3</code> | openai | - | - | Function calling, Image generation, File input | Text | Image |
| GPT Image 1.5<br><code>gpt-image-1-5</code> | openai | - | - | Image recognition, Image generation, File input | Text, Image | Text, Image |
| GPT Image 2.5 Flare<br><code>gpt-image-2-5-flare</code> | openai | - | - | Image recognition, Image generation | Text, Image | Image |
| GPT Image 2.5 Sunburst<br><code>gpt-image-2-5-sunburst</code> | openai | - | - | Image recognition, Image generation | Text, Image | Image |
| GPT-Image-1<br><code>gpt-image-1</code> | openai | - | - | Image recognition, Image generation, File input | Text, Image | Image |
| GPT-Image-1-Mini<br><code>gpt-image-1-mini</code> | openai | - | - | Image recognition, Image generation, File input | Text, Image | Text, Image |
| GPT-Image-2<br><code>gpt-image-2</code> | openai | - | - | Image recognition, Image generation, File input | Text, Image | Image |
| OpenAI: GPT-5 Image<br><code>gpt-5-image</code> | openai | <span title="400,000">400K</span> | - | Reasoning, Image recognition, Image generation, Structured output, File input | Text, Image | Text, Image |
| OpenAI: GPT-5 Image Mini<br><code>gpt-5-image-mini</code> | openai | <span title="400,000">400K</span> | - | Reasoning, Image recognition, Image generation, Structured output, File input | Text, Image | Text, Image |
| Recraft V2<br><code>recraft-v2</code> | recraft | 512 | - | Image generation | Text | Image |
| Recraft V3<br><code>recraft-v3</code> | recraft | 512 | - | Image recognition, Image generation | Text, Image | Image |
| Recraft V4<br><code>recraft-v4</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft V4 Pro<br><code>recraft-v4-pro</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft V4.1<br><code>recraft-v4-1</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft V4.1 Pro<br><code>recraft-v4-1-pro</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft V4.1 Utility<br><code>recraft-v4-1-utility</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft V4.1 Utility Pro<br><code>recraft-v4-1-utility-pro</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4 Pro Vector<br><code>recraft-v4-pro-vector</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4 Styles<br><code>recraft-v4-styles</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4 Styles Pro<br><code>recraft-v4-styles-pro</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4 Styles Pro Vector<br><code>recraft-v4-styles-pro-vector</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4 Styles Vector<br><code>recraft-v4-styles-vector</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4 Vector<br><code>recraft-v4-vector</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4.1 Pro Vector<br><code>recraft-v4-1-pro-vector</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Recraft: Recraft V4.1 Vector<br><code>recraft-v4-1-vector</code> | recraft | - | - | Image recognition, Image generation | Text, Image | Image |
| Sourceful: Riverflow V2 Fast<br><code>riverflow-v2-fast</code> | sourceful | - | - | Image recognition, Image generation | Text, Image | Image |
| Sourceful: Riverflow V2 Pro<br><code>riverflow-v2-pro</code> | sourceful | - | - | Image recognition, Image generation | Text, Image | Image |
| Sourceful: Riverflow V2.5 Fast<br><code>riverflow-v2-5-fast</code> | sourceful | - | - | Image recognition, Image generation | Text, Image | Image |
| Sourceful: Riverflow V2.5 Pro<br><code>riverflow-v2-5-pro</code> | sourceful | - | - | Image recognition, Image generation | Text, Image | Image |
| Stable Diffusion 3<br><code>stable-diffusion-3</code> | stability | - | - | Image generation | Text | Image |
| Stable Diffusion 3.5 Large<br><code>stable-diffusion-3-5-large</code> | stability | - | - | Image generation | Text | Image |
| Stable Diffusion 3.5 Large Turbo<br><code>stable-diffusion-3-5-large-turbo</code> | stability | - | - | Image generation | Text | Image |
| Stable Diffusion v1.4<br><code>stable-diffusion-v1-4</code> | stability | - | - | Image generation | Text | Image |
| Stable Diffusion v1.5<br><code>stable-diffusion-v1-5</code> | stability | - | - | Image generation | Text | Image |
| Stable Diffusion XL Base 1.0<br><code>stable-diffusion-xl-base-1-0</code> | stability | - | - | Image generation | Text | Image |
| Hunyuan Image 3.0<br><code>hy-image-v3-0</code> | tencent | - | - | Image generation | Text, Image | Image |
| Hunyuan Image Lite<br><code>hy-image-lite</code> | tencent | - | - | Image generation | Text | Image |
| Arrow 1.1<br><code>arrow-1-1</code> | vercel | <span title="131,072">128K</span> | <span title="131,072">128K</span> | Image generation | Text | Image |
| Muse Image 1.0<br><code>muse-image-1-0</code> | vercel | - | - | Image recognition, Image generation, File input | Text, Image | Image |
| Vidu Q1<br><code>viduq1</code> | vidu | - | - | Image generation | Text | Image |
| Vidu Q2<br><code>viduq2</code> | vidu | - | - | Image generation | Text | Image |
| Grok Imagine Image<br><code>grok-imagine-image</code> | xai | <span title="16,000">16K</span> | - | Image recognition, Image generation, File input | Text, Image | Image |
| Grok Imagine Image 2.0<br><code>grok-imagine-image-2-0</code> | xai | <span title="64,000">64K</span> | - | Image recognition, Image generation, File input | Text, Image | Image |
| Grok Imagine Image Quality<br><code>grok-imagine-image-quality</code> | xai | <span title="16,000">16K</span> | - | Image recognition, Image generation, File input | Text, Image | Image |
| cogview-4<br><code>cogview-4</code> | zhipu | - | - | Image generation | - | - |
| glm-image<br><code>glm-image</code> | zhipu | - | - | Image generation | Text | Image |

</div>

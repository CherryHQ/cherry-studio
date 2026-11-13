# @cherrystudio/provider-registry

## 0.5.2

### Patch Changes

- [#23402](https://github.com/CherryHQ/cherry-studio/pull/23402) [`5ed9f0c`](https://github.com/CherryHQ/cherry-studio/commit/5ed9f0c7068eae541ac9897ce7c75a2b446a3578) Thanks [@copilot-swe-agent](https://github.com/apps/copilot-swe-agent)! - Route Claude Opus 5.5 Bedrock requests through the adaptive reasoning wire contract.

## 0.5.1

### Patch Changes

- [#24343](https://github.com/CherryHQ/cherry-studio/pull/24343) [`6cfe3be`](https://github.com/CherryHQ/cherry-studio/commit/6cfe3be3e9e87b5f74ab907fe75b49426c1598ea) Thanks [@DeJeune](https://github.com/DeJeune)! - Share the documented DeepSeek V4.1 Flash capacity across its model IDs so versioned IDs resolve the output token limit correctly.

## 0.5.0

### Minor Changes

- [#23363](https://github.com/CherryHQ/cherry-studio/pull/23363) [`c53a5e0`](https://github.com/CherryHQ/cherry-studio/commit/c53a5e02941bc2f35d3270dc73a33b13da82df15) Thanks [@raullenchai](https://github.com/raullenchai)! - Add Rapid-MLX as a keyless local provider, with its provider icon.

## 0.4.0

### Minor Changes

- [#23684](https://github.com/CherryHQ/cherry-studio/pull/23684) [`7a3bb0b`](https://github.com/CherryHQ/cherry-studio/commit/7a3bb0b7af2ebe9a2a468edab2c018ebbbeba65f) Thanks [@ousugo](https://github.com/ousugo)! - Add GPT Image 2.6 scene complexity and animated GIF generation parameters, with a new catalog publication stream for compatible Desktop clients.

## 0.3.6

### Patch Changes

- [#23535](https://github.com/CherryHQ/cherry-studio/pull/23535) [`4fb6b8a`](https://github.com/CherryHQ/cherry-studio/commit/4fb6b8a5dc954baf7a42020ac9bd8fe5c89989bb) Thanks [@Contentment003111](https://github.com/Contentment003111)! - Add the stable Hunyuan 4 model to the Tencent catalog and TokenHub with image input support.

## 0.3.5

### Patch Changes

- [#23648](https://github.com/CherryHQ/cherry-studio/pull/23648) [`52aecc0`](https://github.com/CherryHQ/cherry-studio/commit/52aecc057f6140b279d6bc4d9872f0197574e99e) Thanks [@ousugo](https://github.com/ousugo)! - Add GPT Image 2.6 Sunburst and Flare with official image API IDs, generation and editing support, and supported painting controls.

## 0.3.4

### Patch Changes

- [#23471](https://github.com/CherryHQ/cherry-studio/pull/23471) [`e19a772`](https://github.com/CherryHQ/cherry-studio/commit/e19a772a0620902507fd844f163b122c93512a48) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Discover OpenRouter reranking models and rerank through the OpenRouter provider: the model list now reads the rerank catalog (`?output_modalities=rerank`) and marks those models as rerank-capable, and the OpenRouter extension now provides a reranking model so the connection check reaches `POST /api/v1/rerank` instead of failing with `No such rerankingModel`.

## 0.3.3

### Patch Changes

- [#23425](https://github.com/CherryHQ/cherry-studio/pull/23425) [`6466ef9`](https://github.com/CherryHQ/cherry-studio/commit/6466ef98b47f902fdee26b11fdccd23757a7adc5) Thanks [@ousugo](https://github.com/ousugo)! - Add the stable LongCat-2.5 model with multimodal capabilities, documented token limits, and endpoint-specific reasoning controls.

- [#23393](https://github.com/CherryHQ/cherry-studio/pull/23393) [`befc2f5`](https://github.com/CherryHQ/cherry-studio/commit/befc2f5cb5d31b5c5310f68702660c0ffc659c5c) Thanks [@copilot-swe-agent](https://github.com/apps/copilot-swe-agent)! - Expose reasoning-effort controls for Qwen 3.8 Flash Next and other compatible Alibaba providers.

## 0.3.2

### Patch Changes

- [#22768](https://github.com/CherryHQ/cherry-studio/pull/22768) [`7f18ffb`](https://github.com/CherryHQ/cherry-studio/commit/7f18ffb7d8afbe4f0be48dc714854e5180729a90) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Correct Xiaomi MiMo catalog API model IDs to use the dotted version spelling required by the official endpoint.

## 0.3.1

### Patch Changes

- [#23050](https://github.com/CherryHQ/cherry-studio/pull/23050) [`70677d0`](https://github.com/CherryHQ/cherry-studio/commit/70677d07a720ec48d30501018a8a3605c1601954) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Declare Grok Imagine aspect-ratio controls for image generation and editing on the xAI creator, and route the native Grok image endpoint through the xAI adapter so the selected ratio reaches the wire as `aspect_ratio`.

## 0.3.0

### Minor Changes

- [#19811](https://github.com/CherryHQ/cherry-studio/pull/19811) [`4134610`](https://github.com/CherryHQ/cherry-studio/commit/41346103c62917a01785733d00d39ae43039fcf0) Thanks [@GeorgeDong32](https://github.com/GeorgeDong32)! - Rebrand the DashScope provider as Qwen AI Platform with updated default API endpoints, links, pricing pages, and localized labels. User-saved endpoint overrides are preserved.

- [#19810](https://github.com/CherryHQ/cherry-studio/pull/19810) [`6c19eae`](https://github.com/CherryHQ/cherry-studio/commit/6c19eae14e32ef7b73e4d64a253a4b2320bff7bf) Thanks [@GeorgeDong32](https://github.com/GeorgeDong32)! - Add the QwenCloud provider (DashScope international endpoint) with its chat and image models, endpoint-aware web-search eligibility, and reasoning/sampling contracts.
  
  Enable documented Anthropic web search and fetch on QwenCloud and Qwen AI Platform, including the required system identifier and paired search/fetch routing.

## 0.2.9

### Patch Changes

- [#21869](https://github.com/CherryHQ/cherry-studio/pull/21869) [`27f1231`](https://github.com/CherryHQ/cherry-studio/commit/27f123168ac36d5b116a9458598557af61f85985) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Infer low, medium, and high reasoning effort controls for manually added StepFun step-5-preview models.

## 0.2.8

### Patch Changes

- [#22711](https://github.com/CherryHQ/cherry-studio/pull/22711) [`c43e512`](https://github.com/CherryHQ/cherry-studio/commit/c43e512322b7a878dcc828514991da99c393aa50) Thanks [@ousugo](https://github.com/ousugo)! - Add GPT-6.1 Terra with API pricing, long-context tiers, Responses tools, and Codex-specific context and reasoning limits.

## 0.2.7

### Patch Changes

- [#22719](https://github.com/CherryHQ/cherry-studio/pull/22719) [`3c99b48`](https://github.com/CherryHQ/cherry-studio/commit/3c99b4860c33d220f4296c4f37c3f5a63c4e372a) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Narrow DashScope native web search eligibility to supported model families and exact hosted GLM 5.2 and Kimi K3 SKUs.

## 0.2.6

### Patch Changes

- [#22629](https://github.com/CherryHQ/cherry-studio/pull/22629) [`98d3c26`](https://github.com/CherryHQ/cherry-studio/commit/98d3c268a6d3b2296602adfe1da8160965a32708) Thanks [@JuLuogo](https://github.com/JuLuogo)! - Add the DeepSeek V4 Flash reasoning off switch on the official provider (`thinking.type=disabled` / `reasoningEffort=none`) and expose an explicit Off control in the speed popover.

## 0.2.5

### Patch Changes

- [#22575](https://github.com/CherryHQ/cherry-studio/pull/22575) [`ecef6a7`](https://github.com/CherryHQ/cherry-studio/commit/ecef6a7e32cc78a7976f99e1fbac6adee60b467e) Thanks [@ousugo](https://github.com/ousugo)! - Add Kimi K3.1 Pro and its highspeed variant with reasoning controls, fixed sampling constraints, and Moonshot pricing.

## 0.2.4

### Patch Changes

- [#22515](https://github.com/CherryHQ/cherry-studio/pull/22515) [`f740f7d`](https://github.com/CherryHQ/cherry-studio/commit/f740f7d65d130fb27e0ed6fcf6b62dd00e395811) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Add generate-mode quality and size presets for the GPT Image 2.5 Flare and Sunburst models.

## 0.2.3

### Patch Changes

- [#21999](https://github.com/CherryHQ/cherry-studio/pull/21999) [`5967cf3`](https://github.com/CherryHQ/cherry-studio/commit/5967cf357a4f619b6e01b4c21d8e0d024400989c) Thanks [@SaladDay](https://github.com/SaladDay)! - Rename MiniMax-M3.1-Flash-Preview to MiniMax-M3.1-Flash, preserve documented temperature support for MiniMax-M3 and MiniMax-M3.1-Flash, and refresh catalog content versions.

## 0.2.2

### Patch Changes

- [#21776](https://github.com/CherryHQ/cherry-studio/pull/21776) [`14d63eb`](https://github.com/CherryHQ/cherry-studio/commit/14d63eb93a65e0ea03df84722317bd9e6ec97404) Thanks [@ousugo](https://github.com/ousugo)! - Add Muse Spark Open BF16 and NVFP4 model recognition with multimodal capabilities and the official reasoning levels and default.

## 0.2.1

### Patch Changes

- [#21715](https://github.com/CherryHQ/cherry-studio/pull/21715) [`1b0c69f`](https://github.com/CherryHQ/cherry-studio/commit/1b0c69f9d9f086b3aaace631b187b427aac18aaf) Thanks [@1lck](https://github.com/1lck)! - Add widescreen, portrait, 16:10, and 4K size presets for GPT-Image-2 while preserving the existing sizes for GPT-Image-1 models.

## 0.2.0

### Minor Changes

- [#21675](https://github.com/CherryHQ/cherry-studio/pull/21675) [`a6e7c0f`](https://github.com/CherryHQ/cherry-studio/commit/a6e7c0fcdc0fe0f43e3c63702bf18cf56e72a5ae) Thanks [@WhiteZeek](https://github.com/WhiteZeek)! - Add optional billing URLs to provider website metadata and include billing destinations for OpenAI, Anthropic, CherryIN, and DeepSeek so applications can offer quota-recovery actions.

## 0.1.4

### Patch Changes

- [#19786](https://github.com/CherryHQ/cherry-studio/pull/19786) [`9ef4b13`](https://github.com/CherryHQ/cherry-studio/commit/9ef4b130f343dc4288dbf36dc49d32c35c7ddf15) Thanks [@kennyzheng-builds](https://github.com/kennyzheng-builds)! - Expose the Hugging Face router's Chat Completions endpoint alongside Anthropic Messages and Responses while preserving the default inherited by existing configurations.

## 0.1.3

### Patch Changes

- [#21633](https://github.com/CherryHQ/cherry-studio/pull/21633) [`fda831e`](https://github.com/CherryHQ/cherry-studio/commit/fda831efece6a963c5cdb706cc84767dc1af66dc) Thanks [@DeJeune](https://github.com/DeJeune)! - Add Gemini Embedding 2 Preview, Nano Banana 2.1 and Pro alias metadata, and classify Gemini Omni 1.1 Flash as a video generation model.

## 0.1.2

### Patch Changes

- [#21625](https://github.com/CherryHQ/cherry-studio/pull/21625) [`7a7a424`](https://github.com/CherryHQ/cherry-studio/commit/7a7a4247185a8187e54bb09b77f407bd0c04981c) Thanks [@DeJeune](https://github.com/DeJeune)! - Support Gemini 4 Argon with the updated Google adapter and model catalog. Export context usage helpers that exclude repeated continuation prompts from context occupancy while preserving billed token counts, and allow catalog generation to refresh selected models.

## 0.1.1

### Patch Changes

- [#21547](https://github.com/CherryHQ/cherry-studio/pull/21547) [`cbc8088`](https://github.com/CherryHQ/cherry-studio/commit/cbc8088e51c060c83d129889230dadbed2fde545) Thanks [@pczhao1210](https://github.com/pczhao1210)! - Route New API image generation and editing through the New API adapter so gateway URLs receive the required API version prefix.

## 0.1.0

### Minor Changes

- [#21529](https://github.com/CherryHQ/cherry-studio/pull/21529) [`19309e5`](https://github.com/CherryHQ/cherry-studio/commit/19309e5bef1d89dc479344d844923fb5890eeaa8) Thanks [@DeJeune](https://github.com/DeJeune)! - Publish the cross-platform provider registry with optional bundled catalogs, public JSON exports, portable schemas and snapshot parsing, and shared size-preserving model and provider API ID lookup. Keep Node file loading available through the separate `/node` entry.

---
"@cherrystudio/ai-core": patch
"@cherrystudio/ai-sdk-provider": patch
"@cherrystudio/provider-registry": patch
---

Keep exact paid and free provider offers separate and refresh the verified Qwen4 Max and Nemotron 3.5 Lightning catalog entries.

Add verified CherryIN prices, model endpoints, and limits, including exact free routes and per-image billing.

Use the published CherryIN fixed and context-tier prices for their exact routes. Preserve image usage metadata per provider call and include Gemini tool prompt tokens in the input count. Route Gemini chat and image generation with their exact CherryIN IDs.

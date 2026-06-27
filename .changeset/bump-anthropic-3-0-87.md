---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Bump `@ai-sdk/anthropic` from 3.0.71 to 3.0.87 (backports `sanitizeJsonSchema`) and extend the local patch to wire it into `prepareTools`, so unsupported JSON Schema keywords (e.g. `maxItems`, `minLength`) are stripped from tool `input_schema`. Without it, Claude tool calls routed through AiHubMix-style gateways fail with a 400 ("For 'array' type, property 'maxItems' is not supported"). A pnpm override pins the single patched build so the copies pulled transitively by `@ai-sdk/amazon-bedrock` and `@ai-sdk/google-vertex` collapse onto it.

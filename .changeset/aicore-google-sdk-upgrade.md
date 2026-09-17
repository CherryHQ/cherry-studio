---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Upgrade `@ai-sdk/google` 3.0.64 → 3.0.113 (with `@ai-sdk/google-vertex` 4.0.112 → 4.0.188), picking up upstream's conditional `includeServerSideToolInvocations` for Gemini 3 built-in-tool + function-calling requests. Converge `@ai-sdk/openai-compatible` consumers on 2.0.72 and align the `@ai-sdk/provider-utils` / `@ai-sdk/provider` overrides so every provider resolves a single SDK instance.

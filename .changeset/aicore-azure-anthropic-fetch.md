---
'@cherrystudio/ai-core': patch
---

Forward the caller-injected `fetch` in the `azure-anthropic` provider variant. The variant rebuilds the Anthropic provider via `createAnthropic(...)` from a curated subset of settings and previously dropped `fetch`, so a custom fetch (e.g. a proxy-aware implementation) injected at the provider-config layer was silently lost for Azure Claude requests.

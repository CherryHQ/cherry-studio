---
'@cherrystudio/ai-core': major
---

Expose imported provider exports and tool-factory values as `unknown` until checked. Replace `ProviderModule<Settings>` with `ProviderModule`; the removed type argument did not constrain module exports. Narrow exports before accessing them, and narrow `ToolFactoryPatch.tools` values or retain the concrete factory's inferred return type. `ToolFactoryPatch.providerOptions` now uses `Partial<TypedProviderOptions>`, matching the existing merge contract. Runtime module loading and tool forwarding are unchanged.

---
"@cherrystudio/ai-core": major
---

BREAKING: `AiPlugin.transformParams` must return complete parameters instead of a partial patch. The manager passes each returned object directly to the next plugin without merging or copying it. Migrate `return { temperature: 0.5 }` to `return { ...params, temperature: 0.5 }`, or return `params` unchanged. Omitted fields are now removed. Update all external plugins before upgrading.

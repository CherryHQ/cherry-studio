---
'@cherrystudio/provider-registry': minor
---

Correct `objectValues()` to return a possibly empty array while retaining its literal value types. TypeScript callers that relied on the previous nonempty tuple declaration must establish that guarantee themselves; runtime enumeration is unchanged. Image parameter schema composition now skips absent optional constraints while retaining catalog coercion and per-model validation.

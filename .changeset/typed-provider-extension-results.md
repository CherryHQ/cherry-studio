---
"@cherrystudio/ai-core": major
---

BREAKING: Typed provider creators must return their declared base provider type. Base creation and `getBaseProvider` retain that type; variant creation with a dynamic suffix and `getCachedProvider` return the common `ProviderV3` interface because a variant can use another SDK. Variant lookup retains the declared configuration element type. Azure's base chat wrapper exposes the SDK provider interface plus Azure tools, rather than claiming the complete callable Azure provider API.

Dynamic import registration remains supported and selects only an own creator export. Optional settings still delegate missing required configuration to the SDK creator; the merge does not validate completeness. The legacy import API still trusts its registered creator's provider contract.

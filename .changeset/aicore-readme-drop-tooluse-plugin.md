---
'@cherrystudio/ai-core': patch
---

Correct the README's built-in plugin list. It still advertised a `toolUse` plugin, which was removed along with the rest of the prompt-based tool-use path; `plugins/built-in` now exports `providerToolPlugin` and `webSearchPlugin`.

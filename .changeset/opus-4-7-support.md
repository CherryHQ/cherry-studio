---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Support Claude Opus 4.7:

- Bump `@ai-sdk/anthropic` peer/dependency range to `^3.0.71`, which adds the `claude-opus-4-7` model id, native `xhigh` reasoning effort, `display` on adaptive thinking, and `taskBudget`.
- Widen `ToolFactoryPatch.tools` from `ToolSet` to `Record<string, any>`. The tightened `Tool<INPUT, OUTPUT>` generics in `@ai-sdk/anthropic@3.0.71` (e.g. `webSearch_20260209` returns `Tool<{ query: string }, { type: 'web_search_result', ... }[]>`) are no longer assignable to `ToolSet`'s `Tool<any,any>|Tool<any,never>|Tool<never,any>|Tool<never,never>` union-with-`Pick` intersection. Runtime is a shallow copy into `params.tools`, so the shape is equivalent.

---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Stop replaying `function_call` item ids to the OpenAI Responses API.

- Bump `@ai-sdk/openai` from `3.0.53` to `3.0.109`, which drops `id` from replayed `function_call` input items (upstream fix in `3.0.73`). Cherry always sends `store: false`, so that id names nothing on the server; a relay that synthesizes its own item ids (a UUID rather than `fc_…`) used to poison a topic permanently, because the bad id lived in the persisted history and every later turn replayed it into a `400 invalid_request`. `call_id` alone pairs the call with its `function_call_output`.
- Rebuild the local `@ai-sdk/openai` patch onto `3.0.109`. Seven hunks carry forward (`forceReasoning` sampling params, image `url` fallback, Ark assistant `type`/`status`, `rawReasoningContent` replay, `response.reasoning_text.delta`, `annotations` leniency); the `gpt-image-2` hunk is dropped now that upstream matches a generic `gpt-image-` prefix.
- Bump `@ai-sdk/provider-utils` to `4.0.50` via `pnpm.overrides` — `3.0.109` imports `EXPERIMENTAL_EMBEDDING_MODEL_MAX_INPUT_BYTES_PER_CALL`, which `4.0.48` does not export — and `@ai-sdk/azure` to `3.0.116`, whose pinned `@ai-sdk/openai` is `3.0.109`. Without the azure bump its exact pin resolves to an unpatched `3.0.53` carrying both the bug and none of the local hunks.

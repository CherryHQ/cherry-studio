# @ai-sdk/openai Patch Notes

Cherry Studio applies a Yarn patch to `@ai-sdk/openai@2.0.42` (see `.yarn/patches/@ai-sdk-openai-npm-2.0.42-63cda2d10f.patch`).

## Why this patch exists

- `gpt-5-codex` streaming responses from GitHub Copilot sometimes emit `response.output_item.done` events without first sending `summaryParts` metadata.
- The upstream SDK assumes those arrays are always defined, which throws `TypeError: Cannot read properties of undefined (reading 'summaryParts')` when the data is missing.

## Patch summary

- Adds a defensive guard before iterating `activeReasoningPart.summaryParts` when closing a reasoning stream chunk.
- Keeps compatibility with all other providers; the change is purely additive and only affects reasoning-tool cleanup.

## Maintenance guidance

- Remove the patch once `@ai-sdk/openai` ships a fix (tracked internally as issue #10560).
- When upgrading the dependency, rerun `yarn patch-commit` if the upstream implementation still throws; otherwise delete the local patch and the corresponding entry in `package.json` / `packages/aiCore/package.json`.

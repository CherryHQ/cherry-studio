# Agent Note: One-shot auto-create for Agents and Assistants

Status: proposed

English | [中文](2026-11-12-resource-auto-create.zh.md)

## Problem

Creating an Agent or Assistant always goes through the stepped `ResourceCreateWizard` (`src/renderer/components/resourceCatalog/dialogs/create/ResourceCreateWizard.tsx`). It has three steps for Assistants (basic → System Prompt → knowledge) and up to four for Agents (basic → System Prompt → skills → knowledge). The user has to pick an avatar, write a name, write or generate a prompt, and choose skills and knowledge bases by hand. The only generation help is `PromptPolishActions`, which turns a name into a System Prompt. Nothing turns a stated purpose into a complete configuration. MCP servers cannot be chosen at create time at all; `buildCreateAgentCommand` and `buildCreateAssistantDto` (`src/renderer/utils/resourceCatalog/resourceCreate.ts`) never send them.

The design prototype for this flow settled on one entry page: avatar, name, purpose, and model, followed by either **Auto create** (configure everything) or **Manual create** (the existing wizard, prefilled).

## Proposal

### Entry view in front of the existing wizard

`ResourceCreateWizard` opens on a new entry view. Both kinds share it. It contains:

- an emoji avatar, using the existing `EmojiAvatarPicker`;
- a name, which is optional for auto create;
- a purpose text area, bound to the existing `description` field;
- a model selector, with the same filters as the basic step.

The footer offers Cancel, **Manual create**, and **Auto create**.

- **Manual create** switches to the existing steps at step 1. Avatar, name, model, and purpose (as the description) carry over because they share one form.
- **Auto create** is enabled once the purpose and a model are set. It generates a configuration, merges it into the form, and calls the caller's existing `onSubmit`. All five callers therefore keep a single creation path and need no changes.
- When a caller seeds `initialValues.prompt`, as already-configured templates do, the wizard opens directly on the steps.

### The creator skill: one validated generation

`src/renderer/utils/resourceCatalog/autoConfigure.ts` owns three pieces.

- **Creator system prompt.** It asks the model for exactly one JSON object with these fields:
  - `name`, `emoji`, `description`, `prompt`, `knowledgeBaseIds`, `mcpServerIds`;
  - for Agents, also `skillIds` and `permissionMode`;
  - for Assistants, also `enableWebSearch`.
- **Input builder.** It sends the purpose, the optional name, and compact catalogs of what is actually installed:
  - non-builtin skills (Agents only);
  - knowledge bases;
  - MCP servers;
  - the runtime's allowed permission modes.
- **Validating parser.** It does the following:
  - strips code fences and slices out the JSON object;
  - validates it with zod;
  - drops any ID not in the supplied catalogs;
  - accepts the emoji only if it is a single non-flag emoji, otherwise uses the kind's default avatar;
  - accepts the permission mode only if the runtime allows it and it is not `bypassPermissions`, otherwise uses the runtime's create default;
  - returns nothing when the name or prompt is empty.

Generation calls `fetchGenerate` with the default model, the same one `PromptPolishActions` uses. The model the user picked is only assigned to the new resource. It has a 60-second timeout and is cancelled when the dialog closes. A user-picked avatar or a typed name overrides the generated value. On failure, the dialog shows an error, creates nothing, and keeps Manual create available.

### Create payload

The create values gain two fields: `mcpServerIds`, and `enableWebSearch` for Assistants. Both default to empty or off, so the manual path is unchanged.

- Agents send `mcps` when the runtime supports MCP.
- Assistants send `mcpServerIds`. When MCP servers or web search are selected, they also send the matching `settings`.

Avatars stay emoji-only in this flow. Image upload remains available in the edit dialog.

## Alternatives considered

- **Agent self-configures at runtime.** This would ship a built-in `SKILL.md` and extend `mcp__cherry-tools__config` with avatar, prompt, and skill actions, then open a first session in which the Agent configures itself. Rejected because Assistants have no agent runtime, so the same flow would need two mechanisms. It is also slower, and it widens a tool that runs without approval.
- **Cherry Assistant `create_agent`.** The tool only accepts `name`, `description`, `instructions`, and `model`. It exists only for the built-in Cherry Assistant and cannot create Assistants.
- **Structured output through `ai.text.generate`.** This would be more reliable than parsing JSON out of text. However, the IPC route has no output-schema option, so it is an upstream change left for a separate decision. Text JSON with zod validation works on every provider.
- **Generate with the user-selected model.** Agent-only models may not serve `ai.text.generate`, so the default model is used instead, as it is for prompt polishing.

## Acceptance criteria

- AC1 — Opening the create dialog for an Agent or an Assistant shows the entry view with avatar, name, purpose, model, Manual create, and Auto create, and Auto create stays disabled until purpose and model are set (verification: renderer; owner: implementer)
- AC2 — Manual create opens the existing first step with the entered avatar, name, model, and purpose (as description) already filled in (verification: renderer; owner: implementer)
- AC3 — Auto create with a valid model response calls `onSubmit` once with the generated name, emoji, description, and prompt, while a user-typed name or picked avatar is kept instead of the generated one (verification: renderer; owner: implementer)
- AC4 — Generated skill, knowledge base, and MCP IDs that are not in the installed catalogs never reach the create payload, and the generated permission mode is never `bypassPermissions` (verification: unit; owner: implementer)
- AC5 — A flag, multi-character, or non-emoji avatar value falls back to the kind's default emoji (verification: unit; owner: implementer)
- AC6 — Unparseable output, an empty name or prompt, a generation error, or a timeout shows an error, creates nothing, and leaves Manual create usable (verification: renderer; owner: implementer)
- AC7 — Selected MCP servers reach the created Agent as `mcps` when its runtime supports MCP, and reach the created Assistant as `mcpServerIds` with settings that use them; selected web search reaches the Assistant's settings (verification: unit; owner: implementer)
- AC8 — In the running app, auto-creating one Agent and one Assistant from a purpose produces resources whose edit dialogs show the generated emoji, name, prompt, and selected capabilities (verification: Electron; owner: implementer)
- AC9 — Every new UI string exists in all renderer locales without placeholders (verification: docs gate; owner: implementer)

## Risks

- Model quality varies. Weak models may return prose or poor JSON. The parser rejects it and Manual create stays one click away.
- Generation reads installed skills, knowledge bases, and MCP server names and descriptions and sends them to the default model's provider. This is the same exposure as any chat that lists those resources, but it now happens at create time.
- Auto create can enable MCP servers and skills the user did not inspect. They are limited to resources the user already installed, and everything stays editable afterwards.
- One extra model call adds latency (usually a few seconds) and token cost to each auto create.

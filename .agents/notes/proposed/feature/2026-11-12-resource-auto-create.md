# Agent Note: Purpose-first create flow for Agents and Assistants

Status: proposed

English | [中文](2026-11-12-resource-auto-create.zh.md)

## Problem

Creating an Agent or Assistant always goes through the stepped `ResourceCreateWizard` (`src/renderer/components/resourceCatalog/dialogs/create/ResourceCreateWizard.tsx`). It has three steps for Assistants (basic → System Prompt → knowledge) and up to four for Agents (basic → System Prompt → skills → knowledge). The user has to pick an avatar, write a name, write or generate a prompt, and choose skills and knowledge bases by hand. The only generation help is `PromptPolishActions`, which turns a name into a System Prompt. Nothing turns a stated purpose into a complete configuration. MCP servers cannot be chosen at create time at all; `buildCreateAgentCommand` and `buildCreateAssistantDto` (`src/renderer/utils/resourceCatalog/resourceCreate.ts`) never send them.

The Agent wizard also stops short of what an Agent needs. Built-in tools, MCP servers, IM channels, reply language, heartbeat, and environment variables can only be set after creation, in the edit dialog or in global Settings. The System Prompt step shows only the user's own instructions, so the user cannot see what the Agent actually receives. Creation ends silently: depending on the caller, the dialog closes, selects the new item, or opens a chat, and the user never sees what was configured.

The design prototype (`bot-profile-cherry`) settled on one entry page with avatar, name, purpose, and model, followed by **Auto create** or **Manual create**. It also defines a full Agent wizard, a result page, and avatar picker refinements. [The paged edit dialog](2026-11-12-resource-edit-pages.md) and [the chat profile pane](2026-11-12-chat-profile-pane.md) cover the rest of that prototype.

## Proposal

### Entry view in front of the existing wizard

`ResourceCreateWizard` opens on a new entry view. Both kinds share it. It contains:

- a large, centred emoji avatar, using `EmojiAvatarPicker`;
- a name, which is optional for auto create;
- a purpose text area, bound to the existing `description` field;
- a model selector, with the same filters as the basic step.

The footer offers Cancel, **Manual create**, and **Auto create**.

- **Manual create** switches to the steps at step 1. Avatar, name, model, and purpose (as the description) carry over because they share one form. For an Agent whose System Prompt is still empty, the purpose also prefills the System Prompt.
- **Auto create** is enabled once the purpose and a model are set. It generates a configuration, merges it into the submitted values without rewriting the form, and calls the caller's existing `onSubmit`.
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
  - accepts the emoji only if it is a single RGI emoji that is not a flag, a lone modifier, or a bare symbol, otherwise uses the kind's default avatar;
  - accepts the permission mode only if the runtime allows it and it is not `bypassPermissions`, otherwise uses the runtime's create default;
  - returns nothing when the name or prompt is empty.

Generation calls `fetchGenerate` with the default model, the same one `PromptPolishActions` uses. The model the user picked is only assigned to the new resource. When no default model is set, Auto create says so instead of calling the model. It has a 60-second timeout and is cancelled when the dialog closes. A user-picked avatar or a typed name overrides the generated value. On failure, the dialog shows an error, creates nothing, and keeps Manual create available.

### Avatars

- The default avatar is 💬 for Assistants and ✨ for Agents. The creator prompt still forbids 🤖.
- The `EmojiAvatarPicker` popover gets a header with a 🎲 button that picks a random emoji.
- The shared emoji picker (`src/renderer/components/EmojiPicker`) is restyled: a borderless muted search field, foreground instead of primary for the active category and highlight, 16 px muted category icons with an accent background on hover and selection, 24 px emoji eight per row, and 12 px muted category labels. Keyboard focus stays visible.
- The 🇹🇼 flag (`1f1f9-1f1fc`) is hidden from browsing and search in that picker.
- Whether the user picked an avatar is read from the form's dirty state, not by comparing against the default.

Avatars stay emoji-only in the create flow. Image upload remains available in the edit dialog.

### Steps

The Assistant steps stay basic → System Prompt → knowledge. The Agent steps become basic → tools → skills → knowledge → MCP → channels → advanced. A step is shown only when the Agent's runtime supports it. Agents are created on the Pi Durable runtime with no runtime choice, as today.

- **Basic.** Avatar and name, then permission mode for Agents, then one model. The description field is removed from this step; the purpose entered on the entry view remains the description.
- **Tools (Agent).** Browser control and computer use rows, each with an inactive badge when the feature is off globally and a link to its settings. Then the runtime's built-in tools grouped by category, one switch each. Switching a tool off adds it to `disabledTools`.
- **Skills, knowledge, and MCP.** One list component for all three, also used by the edit dialog. It has a search box, an "Add …" menu, "Enable all", and one row per item with icon, name, description, and switch. The add menus are: skills — online search, local import, system search; knowledge — new knowledge base, import files; MCP — from marketplace, add manually, import JSON. Builtin skills are locked on. The add actions open in-dialog modals that reuse the existing settings-page dialogs.
- **Channels (Agent).** A list of the channels this Agent will own, an "Add channel" menu with every supported platform, and a configuration dialog per channel: name, credentials, allowed chat IDs, mention-only where the platform supports it, and a permission mode that inherits the Agent's or overrides it. The channels are sent with the create command and created in the same main-process transaction as the Agent. Platforms that log in by QR code (WeChat, and Feishu registration) are created bound and inactive, and their QR login runs from the result page or the edit dialog.
- **Advanced (Agent).** The full System Prompt, reply language, heartbeat, and environment variables:
  - **Full System Prompt.** A main-process IpcApi route assembles the prompt the Pi Durable runtime would send, from the draft (instructions, language, skills, disabled tools, knowledge bases), using the same builders the runtime uses. The renderer shows it as read-only segments around one editable block, the Agent's own instructions, with an approximate token count. It refreshes when skills or language change. When the instructions are empty, the sections that depend on them are omitted, as the runtime already does.
  - **Reply language.** One select: follow the global setting (showing its value), no constraint, one of the preset languages, or "Other language…", which reveals a text input. It writes the existing `languageMode` / `languageCustom` mapping.
  - **Heartbeat.** A card with a title, a description, and a switch. When on, it shows interval and maximum run time in minutes, with the existing limits and defaults. Heartbeat tasks are edited after creation.
  - **Environment variables.** A text area with one `KEY=VALUE` per line.

### Result page

Every create path, auto or manual, ends on a result page inside the same dialog. While auto create is generating, the dialog shows a working view with the avatar and what is being configured; it does not fake per-step progress. The result page shows the avatar, name, and description, and a summary of what was configured: System Prompt filled or not, model, permission mode, enabled tools (`X / Y`), skills, knowledge bases, MCP servers, channels (with any pending QR login), and heartbeat. It has two actions:

- **Adjust settings** opens the edit dialog for the new resource.
- **Start conversation** runs the caller's start action: open a chat for the library, the Agent page, and the conversation picker; select the new item for the selectors; open a chat for marketplace templates.

`onSubmit` returns the created resource's ID so the wizard can show it. Every caller of the wizard supplies its start action.

### Create payload

The create values gain `mcpServerIds`, and `enableWebSearch` for Assistants. Agents also gain `disabledTools`, reply language, heartbeat settings, environment variables, and channels. All default to empty or off.

- Agents send `mcps` when the runtime supports MCP, plus the existing `disabledTools` and `configuration` fields.
- Assistants send `mcpServerIds`. When MCP servers or web search are selected, they also send the matching `settings`.

## Alternatives considered

- **Agent self-configures at runtime.** This would ship a built-in `SKILL.md` and extend `mcp__cherry-tools__config` with avatar, prompt, and skill actions, then open a first session in which the Agent configures itself. Rejected because Assistants have no agent runtime, so the same flow would need two mechanisms. It is also slower, and it widens a tool that runs without approval.
- **Cherry Assistant `create_agent`.** The tool only accepts `name`, `description`, `instructions`, and `model`. It exists only for the built-in Cherry Assistant and cannot create Assistants.
- **Structured output through `ai.text.generate`.** This would be more reliable than parsing JSON out of text. However, the IPC route has no output-schema option, so it is an upstream change left for a separate decision. Text JSON with zod validation works on every provider.
- **Generate with the user-selected model.** Agent-only models may not serve `ai.text.generate`, so the default model is used instead, as it is for prompt polishing.
- **Enable all installed skills and leave knowledge bases and MCP for the user.** This is what the prototype first drew. Letting the model choose from the installed catalogs gives a configuration that fits the purpose, and everything stays editable.
- **Claude Agent as the wizard's runtime.** The prototype's tools page lists Claude Agent's 17 tools, but its prompt page shows the Pi prompt. Pi Durable is the product's create runtime, and its prompt can be assembled as text; the Claude Agent base prompt is an SDK preset that cannot be shown.
- **Assemble the full prompt in the renderer.** The prototype copies the assembly into the renderer. A copy drifts from the runtime; the main-process route reuses the runtime's own builders.
- **Create draft channels first and bind them on submit.** Cancelling would leave orphaned channels and QR sessions. Creating them with the Agent in one transaction avoids that.
- **Defer channels to after creation.** Simpler, but the prototype makes channels part of setting up an Agent, and only QR login needs the Agent to exist.

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
- AC10 — A new Agent defaults to the ✨ avatar, the avatar picker's 🎲 button replaces the avatar with a different emoji, and the 🇹🇼 flag cannot be found by browsing or searching the emoji picker (verification: renderer; owner: implementer)
- AC11 — Manual create for an Agent with an empty System Prompt prefills it with the purpose, and the basic step no longer shows a description field (verification: renderer; owner: implementer)
- AC12 — After an auto or manual create, the dialog shows the result page with the configured items, and its two actions open the new resource's edit dialog and run the caller's start action (verification: renderer; owner: implementer)
- AC13 — The Agent wizard shows basic, tools, skills, knowledge, MCP, channels, and advanced steps, and values chosen on each step reach the create command (verification: renderer; owner: implementer)
- AC14 — Switching a built-in tool off in the tools step creates the Agent with that tool in `disabledTools`, and the browser control and computer use rows show an inactive badge when the feature is off globally (verification: renderer; owner: implementer)
- AC15 — The skills, knowledge, and MCP lists filter by search, enable every item with "Enable all", and offer the add actions named in this Spec (verification: renderer; owner: implementer)
- AC16 — Channels configured in the wizard are created bound to the new Agent in the same operation, and a failed Agent create leaves no channel behind (verification: main service test; owner: implementer)
- AC17 — The advanced step shows the assembled Pi Durable System Prompt with only the Agent's instructions editable, and the preview changes when a skill or the reply language changes (verification: main service test and renderer; owner: implementer)
- AC18 — Reply language, heartbeat, and environment variables set in the advanced step reach the created Agent's configuration (verification: renderer; owner: implementer)
- AC19 — In the running app, a manually created Agent with a channel, a disabled tool, and a heartbeat shows all three in its edit dialog after the result page's Adjust settings (verification: Electron; owner: implementer)

## Risks

- Model quality varies. Weak models may return prose or poor JSON. The parser rejects it and Manual create stays one click away.
- Generation reads installed skills, knowledge bases, and MCP server names and descriptions and sends them to the default model's provider. This is the same exposure as any chat that lists those resources, but it now happens at create time.
- Auto create can enable MCP servers and skills the user did not inspect. They are limited to resources the user already installed, and everything stays editable afterwards.
- One extra model call adds latency (usually a few seconds) and token cost to each auto create.
- The emoji picker restyle and the hidden flag apply everywhere the shared picker is used, including the user profile.
- The result page adds one click before a chat opens for callers that used to open it directly.
- Creating channels with the Agent widens the create command and its transaction. A channel that fails validation fails the whole create, so the wizard validates channel forms before submitting.
- The prompt preview reads the same files the runtime reads (workspace `system.md`, memories, bootstrap state). For a new Agent it uses the default workspace, so the preview can differ once the user picks another workspace for a session.

# Composer Tool Surface — UX and Interaction Design

## Scope

This note covers the chat composer tool surface shared by assistant chat and
agent sessions:

- The `+` menu in the message composer.
- The `/` root suggestion panel.
- Active tool chips shown beside the composer controls.
- Visibility, disabled, and tooltip rules for model-dependent or
  scope-dependent tools.

It does not cover the main-process LLM tool registry, tool execution, approval
persistence, or model-side defer exposition except where those concepts affect
renderer discoverability.

## Current Shape

Assistant chat and agent sessions share the same renderer tool runtime:

- `ComposerToolRuntimeHost` resolves tools by `scope`.
- `ComposerToolMenu` renders the `+` menu.
- `ComposerSurface` renders the `/` root suggestion panel from
  `root-panel` launchers.

The current launcher model has two sources:

- `popover` — intended for the `+` menu.
- `root-panel` — intended for the `/` suggestion panel.

The awkward part is that `ComposerToolMenu` currently merges `popover`
launchers with root-only launchers. This makes keyboard/search-oriented items
appear in the `+` menu, and it is most visible in agent sessions where slash
commands can expand into several shallow items.

## Goals

1. Keep core capabilities discoverable even when unavailable.
2. Avoid making the first-level `+` menu a long flat catalog.
3. Preserve fast keyboard workflows for command-style actions.
4. Make assistant-only and agent-only concepts obvious by placement.
5. Keep the model-dependent rules explainable from the UI.

## Non-goals

- Do not expose assistant-only concepts in agent sessions, or agent-only
  concepts in assistant chat, just to keep menus visually symmetrical.
- Do not duplicate the main-side tool registry in renderer state.
- Do not turn the `+` menu into a complete searchable command palette.

## Proposed Interaction Model

### `+` menu: capability discovery and lightweight toggles

The `+` menu should contain stable, user-recognizable capabilities:

- Attach file.
- Knowledge base.
- Web search.
- MCP.
- Thinking / reasoning effort.
- Generate image.
- Permission mode.
- Slash commands parent entry.

The first level should prefer one row per capability. It should not directly
list dynamic children such as each slash command, each MCP prompt, each MCP
resource, every quick phrase, or every knowledge file.

### `/` panel: keyboard-first commands and search

The `/` root suggestion panel should own high-frequency and searchable actions:

- Slash command items.
- Quick phrases.
- MCP prompts.
- MCP resources.
- Other text insertion or command-style launchers.

These entries benefit from filtering, keyboard navigation, and insertion into
the editor. They should stay out of the first-level `+` menu unless they are
represented by a single parent entry.

### Active chips: visible state after selection

Active state should be visible without reopening the `+` menu:

- Web search enabled.
- MCP mode enabled.
- Thinking effort selected.
- Knowledge bases selected.
- Files attached.

These chips are status feedback and quick toggles. They should not replace the
discoverability role of the `+` menu.

## Visibility Policy

Use three categories instead of one blanket filter.

### Show enabled

Show normally when the tool belongs to the current scope and all requirements
are satisfied.

Examples:

- Attachment when the selected model allows at least one supported file type.
- Web search when the assistant and provider configuration can enable it.
- Thinking when the current model has configurable reasoning.

### Show disabled with reason

Show disabled when the user reasonably expects the capability to exist, but a
model, assistant setting, provider setting, or configuration makes it
unavailable.

This should be the default for core capabilities:

- Thinking: current model does not support configurable reasoning.
- Generate image: current model does not support image generation.
- Knowledge base: assistant has no configured knowledge bases, current model
  cannot consume tools, or assistant tool mode is disabled.
- MCP: assistant has no enabled MCP tools, current model cannot consume tools,
  or assistant tool mode is disabled.
- Web search: no usable search provider is configured, or current model /
  provider combination has a known conflict.
- Attachment: no supported file type is available for the selected model.

Disabled rows should include a short tooltip or secondary text. The reason
should be actionable when possible, for example "Select a function-calling
model" or "Configure a web search provider".

### Hide

Hide only when the concept does not belong to the current scope.

Examples:

- Agent permission mode in assistant chat.
- Assistant knowledge-base configuration in agent sessions.
- Agent slash commands in assistant chat.
- Workspace resource mention in assistant chat.

This keeps the two sides honest without making users wonder why a known feature
disappeared because of model capability.

## Assistant Chat Surface

Assistant chat owns assistant-configured context and model-selection workflows.

First-level `+` entries:

| Capability | Default treatment | Notes |
|---|---|---|
| Attachment | Show; disabled if no supported file type | File type support follows selected model set |
| Knowledge base | Show; disabled with reason if unavailable | Belongs to assistant chat only |
| Web search | Show; disabled or guarded with reason | Built-in model search and external provider paths differ |
| MCP | Show; disabled with reason if unavailable | First level is only the mode / parent entry |
| Thinking | Show; disabled if model cannot configure reasoning | Active chip shows selected effort |
| Generate image | Show; disabled if unsupported | Only meaningful for image-capable generation models |
| Quick phrases | Prefer `/` panel, not first-level `+` | If kept in `+`, use a parent entry only |

Model effects:

- Function-calling capability plus assistant `toolUseMode=function` enables
  native tool-use features such as knowledge and MCP.
- Assistant `toolUseMode=prompt` enables prompt-based tool use even when the
  model lacks native function calling.
- Reasoning capability controls whether Thinking can be enabled; fixed
  reasoning models should show disabled rather than silently disappear.
- Image generation capability controls Generate image.
- Vision and image-generation capability control accepted attachment types.
- Mentioned models make attachment support stricter: image/text support should
  reflect the selected model set, not only the assistant's base model.

## Agent Session Surface

Agent sessions own runtime/session concepts rather than assistant chat
configuration.

First-level `+` entries:

| Capability | Default treatment | Notes |
|---|---|---|
| Attachment | Show; disabled if no supported file type | Agent session file tokens only |
| Permission mode | Show | Agent-only; opens a small picker |
| Thinking | Show; disabled if model cannot configure reasoning | Controlled by session-local state before send |
| Slash commands | Show parent entry only when commands exist | Do not flatten each command into `+` |
| Quick phrases | Prefer `/` panel, not first-level `+` | Same search-oriented behavior as assistant chat |

Agent-only affordances:

- Permission mode belongs in `+` because it is a shallow, low-cardinality mode
  picker.
- Slash commands should be a parent row in `+`, with the concrete command list
  handled by QuickPanel or the `/` trigger.
- Workspace resource mention belongs in the editor suggestion flow, not the
  `+` menu, because it depends on search over accessible paths.

Model effects:

- Reasoning capability controls Thinking.
- Vision and image-generation capability control attachment file types.
- Agent type controls slash commands. Today `claude-code` provides `/clear`,
  `/compact`, `/context`, `/cost`, and `/todos`; other agent types provide no
  built-in slash commands.

## Nested Popover Guidance

Use a nested popover only for shallow, bounded, non-search actions:

- Permission mode.
- Thinking effort, if it becomes a picker instead of a cycle action.
- Attachment source selection, if multiple sources are added.

Use QuickPanel instead of nested popovers for list/search actions:

- Slash commands.
- MCP prompts.
- MCP resources.
- Quick phrases.
- Workspace resource search.
- Knowledge file search.

Reason: these lists benefit from filtering, keyboard navigation, and stable
height. Nested popovers are harder to scan, easier to overflow, and worse for
command insertion workflows.

## Launcher Source Contract

Recommended source semantics:

- `popover`: first-level `+` menu entry.
- `root-panel`: `/` suggestion entry.
- A launcher may declare both only when the same row is truly useful in both
  places.

`ComposerToolMenu` should not automatically backfill root-only launchers into
the `+` menu. A tool that wants a parent entry in `+` and child entries in `/`
should register them separately:

- Parent launcher: `sources: ['popover']`.
- Child launchers: `sources: ['root-panel']`.

## Disabled State Requirements

Disabled entries should include:

- A stable label.
- A disabled visual state.
- A reason visible through tooltip or secondary text.
- An optional action hint when the fix is obvious.

Suggested reason examples:

| Capability | Reason |
|---|---|
| Thinking | Current model does not support adjustable reasoning |
| Generate image | Current model does not support image generation |
| Knowledge base | Select a tool-capable model or enable prompt tool use |
| Knowledge base | No knowledge base is configured for this assistant |
| MCP | No MCP tools are enabled for this assistant |
| Web search | Configure a web search provider |
| Attachment | Current model does not accept supported file types |

Keep the text short. Detailed setup flows should open settings rather than
expanding explanatory copy inside the menu.

## Implementation Notes

Likely renderer changes:

1. Add launcher metadata for disabled reason, for example
   `disabledReason?: ReactNode | string`.
2. Stop merging root-only launchers into `ComposerToolMenu`.
3. Convert tool definitions that are currently filtered by capability into
   visible disabled launchers where the feature belongs to the current scope.
4. Keep scope-inapplicable tools hidden.
5. Give Slash Commands a `popover` parent launcher and keep command children
   as `root-panel` only.
6. Keep MCP prompt/resource children as `root-panel` only; use a parent MCP
   row in `+`.
7. Add focused tests for assistant chat and agent session launcher lists.

Targeted test areas:

- `ComposerToolRuntime.test.tsx` for launcher source behavior.
- `ChatComposer.test.tsx` for assistant-side visible/disabled states.
- `AgentComposer.test.tsx` for agent-side slash-command and permission-mode
  behavior.

## Acceptance Criteria

- The `+` menu never appears empty; if no entries are available, the trigger is
  hidden or disabled with a clear reason.
- Core capabilities are discoverable in the correct scope even when disabled.
- Scope-inapplicable capabilities remain hidden.
- `/` remains the primary path for searchable command insertion.
- Agent `+` no longer flattens every slash command into first-level rows.
- Assistant and agent sessions can differ without surprising users about model
  capability constraints.

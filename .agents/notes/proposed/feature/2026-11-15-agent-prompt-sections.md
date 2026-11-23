# Agent Note: Edit every part of a Pi Durable Agent's System Prompt

Status: proposed

English | [中文](2026-11-15-agent-prompt-sections.zh.md)

## Problem

The System Prompt page of a Pi Durable Agent (`PiPromptField`) shows the assembled prompt, but only the Agent's own instructions can be edited. The guidance Cherry writes around them (instruction precedence, reporting deliverables, creating Agents and changing settings, bootstrap, memories, citations) is read-only, so a user who wants different wording has no way to change it. A built-in Agent such as Cherry Assistant shows an empty instructions box, although its built-in prompt is what the runtime uses, and there is no way back to that prompt after editing. Unlike the other runtimes' prompt page, this page has no AI optimize.

## Proposal

- The page leads with the Agent System Prompt and lists the other blocks by name, in the order the runtime sends them. A row is marked only when that matters: Edited for a block the user changed, Read-only for one that cannot be changed there. A block opens on its own page, titled in the dialog header, to edit or read.
- **Guidance blocks** (instruction precedence, reporting deliverables, creating Agents and changing settings, bootstrap, memories, citations) can be edited. An edit is saved for that Agent as an override in `configuration.prompt_overrides`, keyed by block. An edited block is marked as changed. Every editable page has a restore icon in its top right, enabled once there is an edit, which removes the override.
- An override replaces only a block the runtime would generate for the current settings. When a setting removes the block (for example, citations when no lookup tool is enabled), the override is kept but not sent.
- **The Agent System Prompt block** holds the Agent's instructions. For a built-in Agent without its own instructions, it shows the built-in prompt; editing it saves custom instructions, and Restore built-in prompt, a restore icon in the block's top right, clears them so the built-in prompt applies again.
- **AI optimize** is offered on every editable block and rewrites only that block with the default model; the result can be undone, as with the existing prompt polish.
- **The identity block** edits SOUL.md, USER.md, and FACT.md directly: one tab per file, editable at once, with one draft per file and an explicit Save. The block keeps following the files, and an unsaved file edit asks before Back leaves the block.
- **Other live blocks** (workspace instructions, skills, workspace system.md, reply language) can be edited the same way. Until edited, a page is captioned with what keeps the block current; an edited live block says it no longer updates automatically, and the restore icon brings the generated, updating block back.
- All three runtimes use the same editor for Cherry-owned prompt blocks and apply overrides to the blocks they actually assemble. The editor leaves SDK-owned prompt text and MCP server instructions out of the preview. Claude Code lets users disable the SDK's native system prompt while keeping Cherry and workspace instructions.
- The preview route returns each block's key, kind, and generated text, instead of the text before and after the instructions, so the page can show generated text, overrides, and resets per block.
- Pi Durable sends the session workspace path in a read-only `<cwd>` section, matching Pi. A preview opened from a conversation uses that session's workspace. Catalog previews use the latest session or system workspace. [#25204](https://github.com/CherryHQ/cherry-studio/issues/25204)

## Alternatives considered

- Keep the live blocks and reply language read-only (rejected: users want to word every block themselves; an edited copy stops following its data or setting, so the page says so and the restore icon brings the updating block back).
- Save an edited copy of the identity block (rejected: memory would freeze; the identity block edits the files themselves instead).
- Expose SDK-owned prompts (rejected: the harness supplies them and their full text is not part of the editor contract).
- One AI optimize for the whole prompt (rejected: a whole-prompt rewrite is hard to review and would touch blocks the user did not mean to change).

## Acceptance criteria

- AC1 — An Agent's System Prompt page leads with the Agent System Prompt and lists the other blocks by name in runtime order; each opens on its own page, where the working directory is read-only and identity is edited through its files, and an unedited live block is captioned with what keeps it current (verification: renderer; owner: implementer)
- AC2 — Editing a guidance or live block saves an override for that Agent, marks the block as changed, and the next prompt the runtime assembles uses the edited text in that block's place (verification: unit; owner: implementer)
- AC3 — The restore icon in a block's top right removes the override, and the block and the next assembled prompt show the generated text again (verification: unit; owner: implementer)
- AC4 — An override for a block the current settings do not generate is not sent (verification: unit; owner: implementer)
- AC5 — For a built-in Agent without its own instructions, the Agent System Prompt block shows the built-in prompt, and Restore built-in prompt clears edited instructions (verification: renderer; owner: implementer)
- AC6 — AI optimize on an editable block replaces only that block and can be undone (verification: renderer; owner: implementer)
- AC7 — Pi, Pi Durable, and Claude Code use overrides for supported Cherry-owned blocks; MCP server instructions remain server-owned and the Claude Code native prompt can be disabled without losing Cherry or workspace instructions (verification: unit; owner: implementer)
- AC8 — The new block titles, captions, and actions exist in every locale (verification: renderer; owner: implementer)
- AC9 — In the app, an edited guidance block of a Pi Durable Agent appears in its prompt and Restore auto-generated brings back the generated text (verification: Electron; owner: implementer)
- AC10 — The identity block edits SOUL.md, USER.md, and FACT.md directly, with one draft per file saved explicitly, and Back with an unsaved file edit asks before leaving (verification: renderer, Electron; owner: implementer)

## Risks

- An edited live block, such as skills, stops following later changes to its data; the page says so, and the restore icon brings the updating block back.

- An override does not follow later changes to the generated text, such as a new tool name; the changed mark and Restore auto-generated make this visible and recoverable.
- A user can remove guidance the Agent relies on, such as how to report deliverables; that is the user's explicit choice, and the block can be restored.

# Agent Note: Edit every part of a Pi Durable Agent's System Prompt

Status: proposed

English | [中文](2026-11-15-agent-prompt-sections.zh.md)

## Problem

The System Prompt page of a Pi Durable Agent (`PiPromptField`) shows the assembled prompt, but only the Agent's own instructions can be edited. The guidance Cherry writes around them (instruction precedence, reporting deliverables, creating Agents and changing settings, bootstrap, memories, citations) is read-only, so a user who wants different wording has no way to change it. A built-in Agent such as Cherry Assistant shows an empty instructions box, although its built-in prompt is what the runtime uses, and there is no way back to that prompt after editing. Unlike the other runtimes' prompt page, this page has no AI optimize.

## Proposal

- The page leads with the Agent System Prompt and lists the other blocks by name, in the order the runtime sends them, each with how it is produced (auto-generated, edited, or updates automatically). A block opens on its own page, titled in the dialog header, to edit or read.
- **Guidance blocks** (instruction precedence, reporting deliverables, creating Agents and changing settings, bootstrap, memories, citations) can be edited. An edit is saved for that Agent as an override in `configuration.prompt_overrides`, keyed by block. An edited block is marked as changed and offers Restore auto-generated, which removes the override.
- An override replaces only a block the runtime would generate for the current settings. When a setting removes the block (for example, citations when no lookup tool is enabled), the override is kept but not sent.
- **The Agent System Prompt block** holds the Agent's instructions. For a built-in Agent without its own instructions, it shows the built-in prompt; editing it saves custom instructions, and Restore built-in prompt clears them so the built-in prompt applies again.
- **AI optimize** is offered on every editable block and rewrites only that block with the default model; the result can be undone, as with the existing prompt polish.
- **The identity block** opens the Agent's memory editor, the same one as the Memory page, so SOUL.md, USER.md, and FACT.md are edited in place. The block keeps following the files, and an unsaved file edit asks before Back leaves the block.
- **Other live blocks** stay read-only with a caption naming what keeps them current: the skills list, workspace instructions, and MCP server instructions change with skills, the workspace, and MCP servers. The reply language block follows the reply language setting.
- Overrides apply to Pi Durable Agents only, the runtime with a full prompt preview. Claude Code and Pi Agents keep only their instructions editable.
- The preview route returns each block's key, kind, and generated text, instead of the text before and after the instructions, so the page can show generated text, overrides, and resets per block.

## Alternatives considered

- Save edited copies of the live blocks as overrides (rejected: a copy would freeze memory, skills, and workspace instructions, which then no longer update; the identity block edits the files themselves instead).
- Make the reply language block editable (rejected: it would drift from the reply language setting that produces it).
- Apply overrides on every runtime (rejected: only Pi Durable shows the whole prompt, so users could not see the result elsewhere).
- One AI optimize for the whole prompt (rejected: a whole-prompt rewrite is hard to review and would touch blocks the user did not mean to change).

## Acceptance criteria

- AC1 — A Pi Durable Agent's System Prompt page leads with the Agent System Prompt and lists the other blocks by name in runtime order; each opens on its own page, where guidance blocks are editable and live blocks other than identity are read-only and captioned with what keeps them current (verification: renderer; owner: implementer)
- AC2 — Editing a guidance block saves an override for that Agent, marks the block as changed, and the next prompt the runtime assembles uses the edited text in that block's place (verification: unit; owner: implementer)
- AC3 — Restore auto-generated removes the override, and the block and the next assembled prompt show the generated text again (verification: unit; owner: implementer)
- AC4 — An override for a block the current settings do not generate is not sent (verification: unit; owner: implementer)
- AC5 — For a built-in Agent without its own instructions, the Agent System Prompt block shows the built-in prompt, and Restore built-in prompt clears edited instructions (verification: renderer; owner: implementer)
- AC6 — AI optimize on an editable block replaces only that block and can be undone (verification: renderer; owner: implementer)
- AC7 — Claude Code and Pi Agents ignore saved overrides and keep their instructions-only prompt page (verification: unit; owner: implementer)
- AC8 — The new block titles, captions, and actions exist in every locale (verification: renderer; owner: implementer)
- AC9 — In the app, an edited guidance block of a Pi Durable Agent appears in its prompt and Restore auto-generated brings back the generated text (verification: Electron; owner: implementer)
- AC10 — The identity block edits SOUL.md, USER.md, and FACT.md through the memory editor, and Back with an unsaved file edit asks before leaving (verification: renderer, Electron; owner: implementer)

## Risks

- An override does not follow later changes to the generated text, such as a new tool name; the changed mark and Restore auto-generated make this visible and recoverable.
- A user can remove guidance the Agent relies on, such as how to report deliverables; that is the user's explicit choice, and the block can be restored.

# Agent Note: Preserve painting draft identity when defaults arrive

Status: implemented

English | [中文](2026-11-08-painting-draft-default-identity.zh.md)

## Problem

Provider and model defaults can arrive after the initial painting draft is visible. Recreating the untouched draft assigned a new ID. Because the composer runtime is keyed by that ID, hydration unmounted the open model selector and discarded its search input. Opening the selector does not edit the draft, so it did not prevent replacement.

## Decision

Apply provider and model defaults to the existing initial draft while retaining its ID and other fields. Keep the existing initial-draft and untouched guards: late defaults cannot replace another draft or overwrite a user's model choice.

## Alternatives considered

- Retrying the E2E click would conceal a visible interaction interruption.
- Removing default hydration would leave drafts with obsolete provider and model choices.
- Removing the composer's keyed session boundary would change how actual draft switches reset their runtime.

## Consequences

Default hydration updates model selection without replacing the current draft session. An open selector retains its search and remains usable. Actual draft switches still establish their own composer session.

## Verification

- Regression — a real hook/composer/selector test opens and searches the selector before defaults arrive. Before the repair, defaults applied but the original selector detached. Afterward it remains visible, preserves the search and accepts another model selection.
- Regression — 56 related renderer tests, web types and scoped lint pass. Older hosted MP-92 failures also lost their model popup, but their recorded evidence does not establish this hydration race as the incident trigger; hosted acceptance still requires a rerun.

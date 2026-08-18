---
title: Full Access now lifts every per-call approval on Advanced (Claude) and Terminal (dsh) agents
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-18
---

## What changed

"Full Access" (bypassPermissions) on Advanced (Claude Agent) and Terminal (dsh) agents now really means no
approval cards. Tools that used to keep prompting even there — knowledge-base edits (`kb_manage`), image
generation, CLI installs, and the assistant settings/file tools — run directly. Fast (Pi) agents already
behaved this way.

What still stops a Full Access agent, on every runtime:

- disabled tools (always denied);
- shell commands that install into the shared global environment (`npm install -g`, `pip install --user`, …),
  denied outright without a prompt;
- destructive operations blocked for the built-in Cherry Assistant / Support agents;
- unattended turns (channel or scheduled): tools that need a live responder are denied, not silently run —
  Full Access does not conjure an approver.

`AskUserQuestion` still reaches the user in Full Access: it is the tool's function to ask, not a permission
prompt.

On Terminal (dsh) agents, delegated subagents inherit the change: an approval-required tool that previously
dead-ended ("needs interactive approval") under Full Access now runs.

## Why this matters to the user

Anyone who picked Full Access for genuinely unattended work stops being interrupted by the last few approval
cards. Conversely, an agent on Full Access can now bill (image generation), modify knowledge bases, and
install CLIs without asking — that is what the mode's warning has always said.

## What the user should do

Nothing — automatic. Anyone who relied on Full Access still prompting for knowledge-base or install
operations should switch that agent to "Approve for Me" or "Ask Before Acting".

## Notes for release manager

This unifies bypass semantics across all three runtimes; the permission-mode card copy no longer needs a
Pi-specific warning. Internally the Claude runtime's per-tool policy hooks were consolidated into a
declarative guard table (`guardRules.ts`) — "does Full Access lift this rule" is now a declared field, not
per-hook code.

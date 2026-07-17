---
title: Agent knowledge tools now scoped to bound knowledge bases
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-17
---

## What changed

Agents can now be bound to specific knowledge bases (a new "Knowledge" tab in the
agent edit dialog, mirroring assistants). The agent knowledge tools (`kb_search`,
`kb_read`, `kb_list`, `kb_manage`) are now scoped to the bases the agent is bound to.
Previously every agent's knowledge tools ran unscoped against **all** of the user's
knowledge bases. An agent with no bound base no longer sees the knowledge tools at all.

## Why this matters to the user

An existing agent that used to be able to search across every knowledge base will,
after upgrade, have no knowledge tools until the user opens the agent and binds at
least one base under the new Knowledge tab. Once bound, the agent's searches are
limited to those bases (the same security boundary assistants already have).

## What the user should do

Open the agent's edit dialog → Tools → Knowledge and select the knowledge base(s)
the agent should have access to. Agents that should keep broad access can bind all
of the relevant bases explicitly.

## Notes for release manager

No automatic data migration binds existing bases to existing agents — this is a v2
new-concept feature with no v1 history to carry forward. The assistant knowledge
binding is unaffected.

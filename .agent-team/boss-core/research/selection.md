# Research and choices — 2026-09-24

Firecrawl web search found [phuryn/pm-skills](https://github.com/phuryn/pm-skills), [Dean Peters' collection](https://github.com/deanpeters/Product-Manager-Skills) and [Impeccable](https://github.com/pbakaus/impeccable). Inspecting pinned raw files led to these choices:

- Installed create-prd and stakeholder-map from phuryn/pm-skills at 8607e3b077817f89bf4a9b623246219734ac3be0, MIT license retained, documents only. They supply missing PM deliverables without a new service. OpenSpec remains authoritative; no fabricated stakeholder data or automatic communications.
- Rejected Dean Peters' current collection at 1b5a524ebb95e9497fa3f25002d8b8ec528d4444 for this installation: LICENSE is CC BY-NC-SA 4.0; no assumption about permission for broader product use.
- Considered Impeccable at edb9c7fbcba158fb6236bd043d6cba18d9cde8d3. It includes a broad script/live-browser/agent package and strong visual-direction instructions. Existing Boss Electron and design contracts meet the immediate need with less overlap; do not install another browser workflow here.
- Reused installed vercel-react-best-practices. Added vercel-composition-patterns from the pinned UAR copy (vercel-labs/agent-skills 063bee94c3f4df8453406c830b0a7df0f2860278) and the local a11y-gate checklist. The Boss data/token contracts take precedence. No hook installed.
- Reused creator/manage/handoff/models compiled Node skills from the UAR installation, preserving their runtime/reference dependencies. Native adapters export five alternatives; install project copies only.

Context7 resolved /electron/electron and supplied [official security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md), [context isolation](https://github.com/electron/electron/blob/main/docs/tutorial/context-isolation.md) and [sandboxing](https://github.com/electron/electron/blob/main/docs/tutorial/sandbox.md). Their actual IPC/privilege boundaries justify the security role; no unrelated hardening was added.

[harness research](uar-harness-research.md) is retained as a same-day UAR investigation, not a claim about Boss-native activation. Boss-specific install checks are in ../verification.json. [repository-map.md](../repository-map.md) records current source/graph connections. Native CLI support, tool access, pricing and runtime evidence remain separate claims.


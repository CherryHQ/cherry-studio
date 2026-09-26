# Role routing

[team.json](team.json) is canonical. `.agent-team/project-routing.json` selects this team for all code work. Parent adopts boss-lead when nesting is limited. Default active group: lead and one relevant specialist, with an independent verifier activated only at the completed phase boundary; maximum four including lead. Assign disjoint files before parallel work. If delegation is unavailable, work sequentially, report the limitation and do not claim builder-context review is independent.

| Trigger | Role | Tools | Skills |
| --- | --- | --- | --- |
| Architecture, ownership, cross-domain work | boss-lead | Compass, Git/source, native delegation, team CLI | agent-team-creator/manage/handoff/models, openspec-propose |
| Outcomes, priorities, stakeholders, peer dependencies | boss-product | Firecrawl, source/specs, local draft artifacts | create-prd, stakeholder-map, agent-team-handoff |
| User-visible flow, design, accessibility | boss-ux | Electron CDP/DevTools, screenshots/accessibility tree, optional Figma | prometheus-ui-ux, cherry-electron-dev, a11y-gate, vercel-composition-patterns |
| React/windows/components/rich text | boss-renderer | Compass, source, tracked Electron, Playwright | prometheus-ui-ux, cherry-electron-dev, vercel-react-best-practices, vercel-composition-patterns, a11y-gate |
| Electron/IPC/platform/build/release integration | boss-desktop | Compass, logs, process inspection, repo build tools | cherry-electron-dev, agent-team-handoff |
| Sessions/DSH/workspace MCP/skills/UAR | boss-runtime | Compass, protocol evidence, Context7 | agent-team-handoff, cherry-electron-dev |
| Providers/local models/tokens/registry | boss-providers | Compass, Context7, authorized model discovery | agent-team-models, agent-team-handoff |
| SQLite/migrations/data classification | boss-data | Compass, disposable database integration, source generators | agent-team-handoff, cherry-electron-dev |
| MCP/tools/privileged IPC/security | boss-security | Compass, source, official docs, reproducer | agent-team-handoff, review protocol |
| Completed change/release acceptance | boss-verifier | immutable artifacts, real integration receipts, assigned regression runs | prometheus-ui-review for UI work, cherry-regression-test, agent-team-handoff, review protocol |

Read exact skill paths in [skill-bindings.json](skill-bindings.json), [tool-policy.md](tool-policy.md) and [model-policy.md](model-policy.md). Lead assigns uncovered services, src/main/main.ts, src/main/ipc.ts, AiService.ts, shared contracts, manifests, tests, CI, translations, assets and generators explicitly per task. No title grants blanket ownership. Test authors need another final reviewer. Product/UX contracts are task dependencies when needed; maintenance fixes do not need a ceremonial product process.

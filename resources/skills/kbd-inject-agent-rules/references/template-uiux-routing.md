<!-- uiux-routing:start v1 -->
## UI/UX work routing

Before writing or modifying any UI/UX code in this repo, the AI agent
**MUST** follow these steps in order. The roster of skills + source
URLs is cached at
`.kbd-orchestrator/references/uiux-skill-roster.md` (refreshable via
`/kbd-inject-agent-rules --pack uiux-routing --refresh`).

1. **Memory consult.** Run `/kbd-memory-recall` (default-on via
   `assess:before` hook) to populate `prior-context.md` with prior
   UI/UX decisions in surreal-memory.
2. **Resolve an existing context target.** Name the requested file,
   route, component, or surface and confirm that it exists before any
   bounded context load. If the plan names a future path that is not
   present, locate the incumbent surface that currently implements the
   same behavior and record both values: `Context target: <existing>`
   and `Planned destination: <future>`. The existing target is context
   authority; the approved specification and plan still own the final
   destination. If no incumbent can be resolved, record `Context target:
   unresolved` and do not claim that Impeccable analyzed a concrete
   surface.
3. **UI/UX Pro Max analysis.** Run the design-system + audit pass on
   the resolved existing target. Pull palette + font + spacing + a11y
   recommendations from its database.
4. **Impeccable commands.** Only after step 2 resolves an existing
   target, load that bounded context and run `/impeccable audit` +
   `/impeccable critique`. Then run the work-specific commands —
   `/impeccable polish` before shipping, `/impeccable distill` when
   simplifying, `/impeccable animate` when adding motion,
   `/impeccable harden` for edge-case + i18n, etc.
5. **Capability-aware UX review.** Inspect the active skill catalog
   before naming a reviewer. Consult `frontend-design` when installed.
   Consult `ux-designer` only when that exact capability is installed,
   and record the source reported by the catalog. When `ux-designer`
   is absent, record `UX review fallback: UI/UX Pro Max +
   frontend-design` and use those installed capabilities instead; if
   `frontend-design` is also absent, use UI/UX Pro Max alone and record
   the reduced fallback. An absent optional skill is not an unfinished
   requirement, and vendor provenance must never be inferred from a
   skill name.
6. **Vercel skills.** Consult React Best Practices + Composition
   Patterns. For the entity-explorer panel and Chrome extension work
   specifically (changes 10 + 11), **also web-search**: "runtime
   devtools page best practices" AND "Chrome MV3 devtools panel
   patterns" / "react-devtools bridge architecture".
7. **Summarise.** Write a one-paragraph distillation of the relevant
   best practices for this specific task. Reference the roster
   entries you actually consulted.
8. **Only then write code.** The summary above is the prompt context
   for the implementation step.

This routing block is auto-managed; re-run
`/kbd-inject-agent-rules --pack uiux-routing` to update. See
`kbd-process-orchestrator/skills/kbd-inject-agent-rules/SKILL.md` for
the `--pack` flag and the fenced-region machinery.
<!-- uiux-routing:end -->

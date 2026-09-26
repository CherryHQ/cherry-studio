---
name: ui-ux-pro-max
description: Search bundled UI/UX product, style, color, typography, accessibility and platform knowledge; generate a reasoned design-system recommendation when establishing visual direction. Portable Node implementation of the pinned UI/UX Pro Max catalog.
license: MIT
version: 1.0.0-prometheus.1
metadata:
  tags: ui, ux, ui-ux-pro-max
  version-origin: Prometheus packaging version; upstream did not declare a version
---

# UI/UX Pro Max — Prometheus portable runtime

Use the project product context, incumbent design system, tokens and affected application's framework versions first. Follow `prometheus-ui-ux` for operation, mode, craft and platform selection. Recommendations are advisory; project design authority wins. A catalog's framework version metadata is pinned reference data, never an instruction to upgrade the application.

Resolve this skill's installed directory and execute the bundled helper with the available Node.js 22+ runtime. It requires no dependency installation, network service, Python, native engine or shell launcher. Do not assume the repository working directory is the skill directory.

```text
node <skill-directory>/scripts/search.mjs "operational dashboard accessible forms" --domain ux --json
node <skill-directory>/scripts/search.mjs "keyboard navigation React 19" --stack react --json
node <skill-directory>/scripts/search.mjs "healthcare appointment booking" --design-system --project-name "Clinic" --format markdown
```

## Focused retrieval

Use one focused domain/stack query for the current decision. Domains include product, style, color, chart, landing, ux, typography, google-fonts, icons, gsap, react and web. All 22 bundled stack catalogs are available through `--help`. Pass the actual framework version in the query when applicability matters. Do not treat zero results as a recommendation: report the absence and retry a broader relevant query or consult official documentation.

Use `--max-results 1..20` (default 3), `--json` for structured output, `--full` to retain long prose, and optional `--diagnostics` to inspect calibrated ranking and abstention. Code snippets are never truncated. Legacy style names may redirect to another domain.

## New design direction

Use `--design-system` only when establishing or deliberately replacing visual direction. For refinement or review, use focused queries and preserve incumbent identity. Optional `--variance`, `--motion`, `--density` values range from 1 to 10; `prometheus-ui-ux` provides mode-specific defaults. A motion suggestion does not require animation, GSAP, or a dependency installation. Respect reduced-motion settings and the target platform.

The structured result identifies source rows, activated closed-grammar reasoning rules, constraints, defaults, palette mode derivations and design dials. No data string is evaluated as executable code. The requested stack is intentionally a separate query; upstream design-system generation is domain based.

## Persistence and existing decisions

```text
node <skill-directory>/scripts/search.mjs "Clinic booking mobile" --design-system --project-name "Clinic" --persist --output-dir "<project-root>" --page booking --json
```

Writes only `design-system/<project-slug>/MASTER.md` and optional `pages/<page-slug>.md`. Existing master/page files are preserved unless the user authorizes replacement and `--force` is supplied. A new page may be created without replacing its existing master. Forced replacement records a recovery copy. Linked output ancestors/files are rejected. Project `DESIGN.md` is never written. Page overrides inherit `../MASTER.md`; approved project design authority still takes precedence. Stitch artifacts belong in `DESIGN.stitch.md`.

Persist recommendations only when requested by the workflow. For a refinement, read the existing master/page first; do not generate a new master simply because a search was requested. Apply page recommendations through the project design review, not as automatic authority over existing tokens.

## Portability and provenance

[provenance.json](provenance.json) records the immutable upstream revision, MIT notice, asset hashes and adaptations. [PORT.md](PORT.md) identifies presentation differences and verification gaps. Runtime source is TypeScript 7 under `runtime/src`; shipped `scripts/*.mjs` are the executable artifacts. Full and mini use identical portable bytes. The upstream data includes examples for many ecosystems: those strings are reference material, not runtime dependencies or automatically executed commands.

Reference guidance: [pro rules](references/pro-rules.md), [quick reference](references/quick-reference.md). When those historical documents conflict with project design authority, phase-boundary verification or platform-specific accessibility units, the Prometheus routing contract controls.

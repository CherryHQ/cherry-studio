---
name: scaffold-react-vite
description: >
  Convert a refined React TSX artifact into a buildable Vite 8 + React 19 +
  TypeScript + Tailwind v4 + shadcn-on-Base-UI project with kebab-case file
  names and feature-based clean architecture. Optionally wrap the project in
  a self-contained Rust + Axum binary that embeds the dist via rust-embed and
  serves the SPA from a single executable.
---

> ## UNAVAILABLE IN THIS PROJECT
>
> This skill drives a shell scaffolder that `prometheus-skills-mini` does not ship. The scaffolders are
> 2,879 lines of bash across 7 files that generate React/Vite/Tauri/Flutter starter projects; porting
> them is a separate change from the refiner core, and this project forbids executing a `.sh` at all
> (C1, C3) — so the commands below **will not run here**.
>
> The skill is carried rather than deleted so its interface and intent stay visible, and it says so
> loudly rather than appearing functional and failing on invocation. A loud absence beats a silent
> breakage.
>
> **Follow-up:** port the scaffolders to Node, or drop these skills. Tracked in
> `.prometheus/decisions.md` (2026-09-21, scope of the artifact-refiner port).

# Scaffold React + Vite

Take a refined React TSX artifact (from ideation, `refine-ui`, or
`convert-htmx-react`) and a brand TOML, produce a buildable project on disk.

## Setup

1. Set `artifact_type: scaffold`
2. Set `content_type: direct:scaffold`
3. Load domain adapter from `references/domain/ui.md`
4. Load convention docs:
   - `references/scaffolds/clean-architecture.md`
   - `references/scaffolds/kebab-case-rename.md`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- `--name <artifact-name>` (required) — feature folder name, kebab-cased automatically
- `--source <path-to-tsx>` (required) — the refined TSX artifact
- `--brand <brand-name>` (required) — brand TOML stem under `assets/library/brands/`
- `--target <path>` (required) — output directory (must not exist; v1 has no overwrite)
- `--with-axum-wrapper` (optional flag) — also generate `<target>/server/` with the Rust binary

## Procedure

Dispatch to the orchestration script:

```bash
bash scripts/scaffold-react-vite.sh \
  --name "${NAME}" \
  --source "${SOURCE_TSX}" \
  --brand "${BRAND}" \
  --target "${TARGET}" \
  ${WITH_AXUM:+--with-axum-wrapper}
```

The script:

1. Pre-flight: verifies `pnpm`, `node`, `template-forge` are present.
2. Runs `pnpm dlx shadcn@latest init --template vite --base base --yes` to scaffold the React stack.
3. Renders brand-tokens CSS via `template-forge render --template vite-shell-css`.
4. Reorganizes the default tree into clean-architecture layout (`src/{app,features,shared}/`).
5. Patches the source TSX into `src/features/<name>/`:
   - Default export → `components/<name>.tsx`
   - Named hooks (`useFoo`) → `hooks/use-foo.ts`
   - Other named exports → routed per `kebab-case-rename.md` heuristic
   - Auto-`shadcn add` any `@/shared/components/ui/<name>` imports it finds
6. Updates `components.json`, `tsconfig.json` aliases.
7. Rewrites `src/main.tsx` to consume the feature.
8. Writes `<target>/README.md` recording provenance.
9. Runs `pnpm install && pnpm build` to verify.
10. If `--with-axum-wrapper`, chains into `scaffold-react-vite-axum.sh`.

## Architectural Baseline

Every scaffolded project conforms to the **state architecture** documented at
`references/scaffolds/state-architecture.md`:

- **Components → Hooks → Stores → I/O** (strict dependency rule, enforced via generated `eslint.config.mjs`)
- **zustand + immer** installed automatically; `src/features/<f>/stores/` and `src/app/stores/` directories created
- **Local `useState`** allowed only for ephemeral single-component state (toggles, drafts)
- **Stores own all I/O and realtime subscriptions**; stores never import React
- **TSX always**, never JSX

The scaffolder routes named exports during patching:

- `useXxxStore` (matches `/^use[A-Z].*Store$/`) → `src/features/<f>/stores/`
- `useXxx` (matches `/^use[A-Z]/` but not ending in `Store`) → `src/features/<f>/hooks/`
- Default-exported component → `src/features/<f>/components/<feature>.tsx`

Responsive primitives are emitted into every scaffold:

- `src/shared/hooks/use-breakpoint.ts` (viewport-classifier hook)
- `src/shared/hooks/use-is-mobile.ts`
- `src/app/responsive-shell.tsx` (desktop/mobile layout switcher)
- `src/shared/lib/runtime.ts` (`isTauri()` helper)
- Brand CSS template includes safe-area-inset variables

## Default Constraints

- Target directory must not exist (no overwrite in v1).
- Source TSX must be a single .tsx file.
- File names are always kebab-case.
- React component identifiers stay PascalCase (only files are renamed).
- Hook function names stay camelCase with `use*` prefix.
- Features cannot import from other features (clean architecture rule).
- Tailwind v4 CSS-vars (`--background`, `--foreground`, etc.) and brand-tokens (`--color-bg`, `--color-ember`, etc.) live in separate namespaces and never collide.
- shadcn components land in `src/shared/components/ui/`.

## When to Use the Axum Wrapper

Add `--with-axum-wrapper` when the deliverable is a **single-binary self-contained server**:

- Distributing a desktop app or kiosk that ships one executable.
- Deploying to a container, edge runtime, or VM without a Node.js runtime.
- Wanting to add Rust API routes alongside the SPA (the generated `main.rs` has axum visible — just add routes).

Do not use the wrapper when:

- The frontend will be deployed to a static-only host (Vercel, Netlify static, S3).
- You want hot-reload during frontend development (use `pnpm dev` directly; the binary is for production).

## Output Contract

```yaml
artifact_type: scaffold
content_type: direct:scaffold
outputs:
  - path: <target>/
    description: Buildable Vite + React 19 + TS + shadcn-on-Base-UI project
  - path: <target>/server/   # only when --with-axum-wrapper
    description: Rust + Axum binary that embeds and serves the SPA
constraints_satisfied:
  - vite_8_react_19_tailwind_v4
  - shadcn_on_base_ui
  - kebab_case_file_names
  - feature_based_clean_architecture
  - brand_tokens_applied
  - pnpm_build_succeeds
  - cargo_check_succeeds  # when --with-axum-wrapper
```

## References

- `references/scaffolds/clean-architecture.md` — directory + dependency rules
- `references/scaffolds/kebab-case-rename.md` — renaming heuristic
- `tools/template-forge-rs/templates/vite-shell-css.html` — brand CSS template
- `openspec/changes/phase-2-scaffold-react-vite/{proposal,tasks,design}.md` — design rationale

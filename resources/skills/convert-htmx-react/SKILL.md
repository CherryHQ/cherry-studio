---
name: convert-htmx-react
description: >
  Convert an HTMX + Alpine.js HTML artifact into a React TSX component ready
  for the scaffold-react-vite pipeline. Mechanical transforms run via a Node
  script; HTMX/Alpine constructs requiring judgment are surfaced as a sidecar
  markdown for review.
---

# Convert HTMX ↔ React

Convert an HTMX + Alpine.js HTML artifact into a React TSX component.

## Setup

1. Set `artifact_type: html` (input) → `react` (output)
2. Set `content_type: direct:react`
3. Load domain adapter from `references/domain/ui.md`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- `--source <path-to-html>` (required)
- `--feature-name <kebab-name>` (required) — used to name the component (PascalCase) and the hook
- `--output <path-to-tsx>` (required)
- `--ambiguous-sidecar <path>` (optional; default `<output>.ambiguous.md`)

## Procedure

Dispatch to the orchestration script:

```bash
node scripts/convert-htmx-react.mjs \
  --source "${SOURCE}" \
  --feature-name "${FEATURE}" \
  --output "${OUTPUT}"
```

The script:

1. Parses the HTML via `parse5` (spec-conformant HTML5 parsing).
2. Walks the tree and emits JSX with mechanical transforms:
   - `class` → `className`, `for` → `htmlFor`
   - Inline `style="a: b"` → `style={{ a: "b" }}`
   - Self-closing tags closed
   - `data-*`, `aria-*`, `role`, `id`, `src`, `href`, etc. pass through unchanged
3. Lifts Alpine `x-data="{ count: 0 }"` into a named hook `use<Feature>State` exporting `useState` declarations.
4. Converts Alpine bindings:
   - `@click="count++"` → `onClick={() => setCount((v) => v + 1)}`
   - `@click="x = expr"` → `onClick={() => setX(expr)}`
   - `x-text="count"` → `{count}` JSX child
5. Surfaces to the sidecar (and leaves a marker comment in JSX):
   - HTMX `hx-*` behaviors (`hx-get`, `hx-post`, `hx-target`, `hx-swap`)
   - `x-show`, `x-model`, `x-if` (non-trivial Alpine constructs)
   - Complex Alpine expressions

## Reviewing Ambiguous Regions

The sidecar `<output>.ambiguous.md` lists each region the script couldn't auto-convert with confidence. For each region:

1. Source HTML/Alpine fragment
2. Recommended React equivalent
3. The reasoning (e.g., "hx-post + hx-target + hx-swap → useState + fetch + setState")

Review each region, accept the recommendation or propose an alternative, and apply the change manually before feeding the TSX into the scaffolder. The script's job is to do 90% mechanical work and document the remaining 10% clearly — not to guess.

## State Lift Threshold

When the source HTMX contains Alpine `x-data="{ ... }"`, the converter lifts
the state to React. The threshold determines the *shape* of the React state:

| Alpine x-data shape | React shape |
|---|---|
| Single boolean field (`{ open: false }`, `{ active: true }`) | Local `useState` hook |
| Multi-field (`{ count: 0, label: "idle" }`) | zustand+immer store + hook adapter |
| Single non-boolean field (`{ count: 0 }`) | zustand+immer store + hook adapter |

Rationale: per `references/scaffolds/state-architecture.md`, ephemeral
single-component state (e.g., dropdown open/closed) belongs in local `useState`;
anything that might be shared, persisted, or grow beyond a toggle belongs in
a store. The threshold catches counts, labels, and arrays at conversion time so
the scaffolder's `useXxxStore` routing picks them up correctly.

## Default Constraints

- v1 is **HTMX → React only**. Reverse direction (React → HTMX) is deferred.
- Source must be a single `.html` fragment or document.
- Output is a single `.tsx` file with a default-exported component named `<PascalFeature>` and (if Alpine state was present) a named hook `use<PascalFeature>State`.
- Output is scaffolder-ready — no further hand-editing needed for the scaffolder to consume it.

## Output Contract

```yaml
artifact_type: react
content_type: direct:react
outputs:
  - path: <output>.tsx
    description: Scaffolder-ready TSX with default component + optional named hook
  - path: <output>.ambiguous.md
    description: (only when ambiguous regions found) review-required transforms
constraints_satisfied:
  - mechanical_transforms_complete
  - alpine_state_lifted_to_useState
  - htmx_behaviors_documented_for_review
  - scaffolder_input_shape_matched
```

## Composition with Other Skills

Typical flow:

```
HTMX artifact → convert-htmx-react → TSX → scaffold-react-vite → built Vite project
                                                            ↓
                                          (optionally) → rebrand-artifact for brand swap
```

## References

- `scripts/convert-htmx-react.mjs` — the orchestration script
- `openspec/changes/phase-3-conversion-layer/` — design rationale

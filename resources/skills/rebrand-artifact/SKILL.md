---
name: rebrand-artifact
description: >
  Swap one brand's tokens for another's inside a TSX artifact. Mechanical AST
  rewrite swaps matching hex literals; regenerates the brand-vars CSS via
  template-forge. WCAG contrast is reported, not gated.
---

# Rebrand Artifact

Apply a target brand guide's tokens to a TSX artifact while preserving
structure, content, and behavior.

## Setup

1. Set `artifact_type` matching the source (`react`)
2. Set `content_type: direct:react`
3. Both from-brand and to-brand TOMLs must exist under `assets/library/brands/`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- `--source <path-to-tsx>` (required) — input TSX
- `--from-brand <name>` (required) — current brand (e.g., `knowme`)
- `--to-brand <name>` (required) — target brand (e.g., `prometheus-ags`)
- `--output <path-to-tsx>` (required) — rebranded TSX
- `--css-output <path-to-css>` (optional; default `<output>.css`) — regenerated brand-vars CSS
- `--ignore-contrast` (optional flag) — suppress WCAG warnings

## Procedure

Dispatch to the orchestration script:

```bash
node scripts/rebrand-artifact.mjs \
  --source "${SOURCE}" \
  --from-brand "${FROM_BRAND}" \
  --to-brand "${TO_BRAND}" \
  --output "${OUTPUT}" \
  --css-output "${CSS_OUTPUT}"
```

The script:

1. Loads both brand TOMLs via `@iarna/toml`.
2. Flattens each into `{ "colors.dark.ember": "#E04E28", ... }` for hex-valued fields only.
3. Builds a value→value swap map where the same logical path has different hex.
4. AST-parses the source TSX via `@babel/parser` (with JSX + TS plugins).
5. Walks `StringLiteral` nodes via `@babel/traverse`; swaps exact-match from-brand hex with the to-brand equivalent.
6. Also rewrites hex literals embedded inside larger strings (e.g., `"background: #abc"`).
7. **Does NOT modify `var(--color-*)` references** — those are CSS-variable lookups, and the CSS file holds the canonical values.
8. Regenerates the brand-vars CSS for the to-brand via `template-forge render --template vite-shell-css --brand <to-brand>` to the `--css-output` path.
9. Runs a WCAG contrast report on the new palette and prints the result.

## Contrast Validation

The contrast report covers:

- `ink on bg` (dark + light)
- `ember on bg` (dark + light)
- `muted on bg` (dark + light)
- `white on ember` (button surface)

Each pair is scored AAA / AA / A / FAIL by WCAG 2.1 relative luminance. **The report does not block output.** Pairs at "A" or "FAIL" levels are flagged as warnings; the user decides whether to accept the trade-off or pick different brand tokens.

To suppress the warning summary (e.g., in CI), pass `--ignore-contrast`.

## Default Constraints

- The two brand TOMLs must exist; missing brand → error.
- Output is a single rewritten TSX + a regenerated CSS file.
- `var(--color-*)` references in TSX are preserved as-is.
- WCAG report covers AA-level pairs; users wanting AAA should manually inspect.

## Output Contract

```yaml
artifact_type: react
content_type: direct:react
outputs:
  - path: <output>.tsx
    description: Rebranded TSX with hex literals swapped
  - path: <output>.css
    description: Regenerated brand-vars CSS for the new brand
  - stderr_report: WCAG contrast report
constraints_satisfied:
  - hex_literals_swapped
  - var_references_preserved
  - css_file_regenerated
  - contrast_reported
```

## Composition with Other Skills

```
TSX artifact + brand A → rebrand-artifact (A → B) → TSX + CSS for brand B
                                                          ↓
                                              → scaffold-react-vite for production
```

## References

- `scripts/rebrand-artifact.mjs` — the orchestration script
- `scripts/lib/wcag-contrast.mjs` — contrast helper
- `tools/template-forge-rs/templates/vite-shell-css.html` — CSS template
- `openspec/changes/phase-3-conversion-layer/` — design rationale

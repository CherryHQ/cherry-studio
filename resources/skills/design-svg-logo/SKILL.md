---
name: design-svg-logo
description: >
  Lightweight SVG logo creation for ideation. Mode-switching between LLM-suggested
  SVG (with strict parseability + XSS validation) and a deterministic Minijinja
  placeholder. Exports PNG raster set when `rsvg-convert` is available.
---

# Design SVG Logo

Quick SVG icon / wordmark / lockup generator for brand ideation. Lighter than
`refine-logo` — no full brand system; no showcase HTML.

## When to Use This Skill vs `refine-logo`

| Use this skill (`design-svg-logo`) | Use `refine-logo` instead |
|---|---|
| Sketching one or two concept variants | Establishing a production brand system |
| No existing brand guide | Have or want a full brand guide |
| Want SVG + PNG only | Need showcase HTML, manifests, multi-variant suite |
| Ideation, fast turnaround | Final brand identity |

## Setup

1. Set `artifact_type: svg`
2. Set `content_type: direct:svg`
3. Phase-prefer-endpoint-consumption must be in place (for `--mode llm`)

## User Input

The user will provide: $ARGUMENTS

Parse for:
- `--brand-name <name>` (required) — string used in wordmark / lockup
- `--brief <one-line>` (required) — what the brand does
- `--style <keywords>` (optional)
- `--primary-color <hex>` (optional; default `#E04E28`)
- `--output-dir <dir>` (required)
- `--mode llm|placeholder` (optional; default `llm`)
- `--variants icon,wordmark,lockup` (optional; default all three)
- `--png-sizes 16,32,64,128,256,512` (optional; default this list)

## Procedure

Dispatch to the orchestration script:

```bash
node scripts/design-svg-logo.mjs \
  --brand-name "${BRAND_NAME}" \
  --brief "${BRIEF}" \
  --primary-color "${PRIMARY_COLOR}" \
  --output-dir "${OUTPUT_DIR}" \
  ${MODE:+--mode "${MODE}"} \
  ${STYLE:+--style "${STYLE}"}
```

### LLM path (default `--mode llm`)

For each variant (icon, wordmark, lockup):

1. Construct a structured prompt with viewBox hint, brand name, brief, style keywords, primary color, and security constraints (no `<script>`, no `on*=`, no `javascript:` URLs)
2. Call `chat("refiner-iterate", ...)` — routes to small tier
3. Strip markdown fences from response
4. Validate via `scripts/lib/svg-validate.mjs#isValidSvg()` — strict parseability + XSS rejection
5. On validation failure OR `HostHarnessRoutingError`: fall back to placeholder for that variant only

### Placeholder path

- **Icon:** renders via `tools/template-forge-rs/templates/logo-icon.html` (brand initial centered on rounded ember-colored rect)
- **Wordmark:** deterministic SVG with brand name in `system-ui` at primary color
- **Lockup:** icon mark + wordmark side-by-side

### PNG rasterization

- Per variant + PNG size, runs `rsvg-convert -w <size> <svg> -o <png>` if available
- If `rsvg-convert` absent: copies the SVG to a `.png` filename with a warning
- Icon gets all sizes; wordmark + lockup get sizes >= 128 only (smaller would be unreadable)

## SVG validation

Per `scripts/lib/svg-validate.mjs`, every emitted SVG must:

- Open with `<svg` and close with `</svg>`
- Contain NO `<script>` tags
- Contain NO `on*=` event-handler attributes (onclick, onload, etc.)
- Contain NO `javascript:` URLs in href / xlink:href / src
- Parse via `parse5` without errors

LLM outputs failing any check fall back to placeholder. Placeholder outputs are generated deterministically and pass validation by construction.

## Default Constraints

- All SVGs use `viewBox` + explicit width/height
- No raster image embeds inside SVG (paths/rects/circles only)
- All paths use brand-primary color where appropriate; system fonts as fallback
- PNG sizes default to standard set: 16, 32, 64, 128, 256, 512
- Output naming: `<brand-kebab>-{icon,wordmark,lockup}.svg`, `png/<brand-kebab>-{variant}-<size>.png`

## Composition with Other Skills

```
Brand name + brief
  → design-svg-logo (LLM or placeholder)
  → SVG variants + PNG export set

For production brand systems: use refine-logo instead.
```

## Output Contract

```yaml
artifact_type: svg
content_type: direct:svg
outputs:
  - path: <output-dir>/<brand>-icon.svg
  - path: <output-dir>/<brand>-wordmark.svg
  - path: <output-dir>/<brand>-lockup.svg
  - path: <output-dir>/png/<brand>-<variant>-<size>.png
audit_log: .refiner/logo-<brand>/model-routing.log
constraints_satisfied:
  - svg_validated_no_script_or_handlers
  - llm_failures_fall_back_to_placeholder
  - viewbox_present
  - png_set_generated_or_svg_copied
```

## References

- `scripts/design-svg-logo.mjs` — orchestration script
- `scripts/lib/svg-validate.mjs` — strict SVG validator
- `tools/template-forge-rs/templates/logo-icon.html` — Minijinja placeholder template
- `openspec/changes/phase-3b-aux-conversions/` — design rationale

---
name: refine-moodboard
description: >
  Synthesize a single-file HTMX moodboard from a use-case brief. LLM-primary
  (the LLM produces structured JSON; a Minijinja template renders the HTML).
  Falls back to placeholder mode when the inference proxy is unreachable.
---

# Refine Moodboard

**First LLM-primary script in the repo.** The LLM is the engine, not a sidecar.
A structured prompt requests `{ palette, typography, motifs, tone }` JSON; the
Minijinja `moodboard.html` template renders the result.

## Setup

1. Set `artifact_type: html`
2. Set `content_type: direct:html`
3. Phase-prefer-endpoint-consumption must be in place (`scripts/lib/openai-client.mjs`)
4. openai-proxy reachable at `model_policy.endpoints.openai_proxy.base_url` (else falls back to placeholder)

## User Input

The user will provide: $ARGUMENTS

Parse for:
- `--use-case <description>` (required)
- `--audience <descriptor>` (required)
- `--aesthetic <keywords>` (required, comma-separated)
- `--output <path-to-html>` (required)
- `--brand <brand-name>` (optional — anchors LLM/placeholder to an existing brand)
- `--mode llm|placeholder` (optional; default `llm`)
- `--palette-mode light|dark|both` (optional; default `both`)

## Procedure

Dispatch to the orchestration script:

```bash
node scripts/refine-moodboard.mjs \
  --use-case "${USE_CASE}" \
  --audience "${AUDIENCE}" \
  --aesthetic "${AESTHETIC}" \
  --output "${OUTPUT}" \
  ${BRAND:+--brand "${BRAND}"} \
  ${MODE:+--mode "${MODE}"}
```

### LLM path (default)

1. Constructs a structured prompt requesting JSON with exact shape: `{ meta, palette: { light, dark }, typography, motifs?, tone? }`
2. Calls `chat("refiner-evaluate", ...)` — routes to medium tier per `model_policy`
3. Strips markdown fences from the response
4. Rejects responses containing prompt-injection markers (`SYSTEM:`, `IGNORE PREVIOUS`, etc.)
5. Validates JSON shape — every palette field must be a hex literal; typography must include display/ui/body
6. If validation fails OR `HostHarnessRoutingError` fires → falls back to placeholder
7. Writes the spec to a synthetic brand TOML; renders via `template-forge render --template moodboard`

### Placeholder path

- If `--brand` supplied: uses that brand's existing palette + typography
- Else: neutral gray placeholder (system fonts, gray scale) marking the moodboard as "design TBD"
- Same template render via `template-forge`

## Default Constraints

- Output is a **single .html file** with inline CSS
- Light + dark palettes both included
- Typography: display + UI + body + mono (Google Fonts names from LLM; system-ui from placeholder)
- Motif tiles + tone chips — placeholder text in both modes (motif visual generation is out of scope)
- Audit log line written to `.refiner/moodboard/model-routing.log` per call
- LLM mode degrades gracefully — `pnpm` smoke tests pass with or without proxy

## Composition with Other Skills

```
Use case + audience + aesthetic
  → refine-moodboard (LLM synthesizes spec)
  → moodboard.html (Minijinja render)
  → optional rebrand-artifact to swap into a different brand
```

## Output Contract

```yaml
artifact_type: html
content_type: direct:html
outputs:
  - path: <output>.html
    description: Single-file HTML moodboard with palette swatches, typography specimens, motif tiles, tone chips
audit_log: .refiner/moodboard/model-routing.log
constraints_satisfied:
  - llm_spec_validated_or_placeholder_fallback
  - prompt_injection_markers_rejected
  - palette_shape_validated
  - both_light_and_dark_palettes_present
  - single_file_html
```

## References

- `scripts/refine-moodboard.mjs` — orchestration script
- `scripts/lib/openai-client.mjs` — `chat()` helper
- `tools/template-forge-rs/templates/moodboard.html` — Minijinja template
- `openspec/changes/phase-3b-aux-conversions/` — design rationale

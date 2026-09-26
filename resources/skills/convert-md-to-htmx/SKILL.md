---
name: convert-md-to-htmx
description: >
  Convert a Markdown document into a self-contained branded HTMX artifact via
  the deterministic markdown-it pipeline with frontmatter support, semantic
  HTML wrapping, and brand-CSS injection.
---

# Convert Markdown to HTMX

Deterministic Markdown → single-file HTML conversion with brand styling.

## Setup

1. Set `artifact_type: html`
2. Set `content_type: direct:html`
3. Source MD file must exist; brand TOML must be registered under `assets/library/brands/`

## User Input

The user will provide: $ARGUMENTS

Parse for:
- `--source <path-to-md>` (required)
- `--brand <brand-name>` (required) — must resolve under `assets/library/brands/<name>.toml`
- `--output <path-to-html>` (required)
- `--document-type article|brief|spec|moodboard|none` (optional; default `article`; frontmatter overrides)

## Procedure

Dispatch to the orchestration script:

```bash
node scripts/convert-md-to-htmx.mjs \
  --source "${SOURCE}" \
  --brand "${BRAND}" \
  --output "${OUTPUT}" \
  ${DOC_TYPE:+--document-type "${DOC_TYPE}"}
```

The script:

1. Reads MD source; extracts YAML/TOML frontmatter via `gray-matter`. Frontmatter keys (`title`, `document-type`) override CLI flags.
2. Renders MD → HTML via `markdown-it` configured for:
   - GFM tables, task lists, strikethrough
   - Auto-linked bare URLs
   - Heading anchors via `markdown-it-anchor`
   - Smart typography (curly quotes, em-dashes)
3. Wraps the body in semantic HTML per `--document-type`:
   - `article` → `<article>` with `<header>`, `<main>`, `<footer>`
   - `brief` / `spec` → similar with type label
   - `none` → bare HTML
4. Injects brand CSS via `template-forge render --template vite-shell-css --brand <brand>` into an inline `<style>` block. No external CSS dependency.
5. Writes a single self-contained `.html` file.

## Default Constraints

- Output is a **single .html file** — no external CSS or JS
- `html: false` in markdown-it — embedded HTML in source MD is escaped (sanitization)
- Heading anchors are added for h1-h4 with `header-anchor` class
- Brand tokens (`var(--color-bg)`, `var(--color-ink)`, etc.) are applied via `:root`
- No syntax highlighting — code blocks keep `<code class="language-X">` for post-build tooling (Prism, Shiki)

## Frontmatter example

```markdown
---
title: My Article Title
document-type: brief
---

Body content here…
```

## Composition with Other Skills

```
Markdown source → convert-md-to-htmx → branded HTML
                                      ↓
                          (optional) rebrand-artifact for brand swap
```

## Output Contract

```yaml
artifact_type: html
content_type: direct:html
outputs:
  - path: <output>.html
    description: Single self-contained branded HTML document
constraints_satisfied:
  - markdown_parsed_via_markdown-it_gfm
  - frontmatter_extracted_via_gray-matter
  - brand_css_injected_inline
  - single_file_no_external_dependencies
```

## References

- `scripts/convert-md-to-htmx.mjs` — orchestration script
- `tools/template-forge-rs/templates/vite-shell-css.html` — brand CSS template
- `openspec/changes/phase-3b-aux-conversions/` — design rationale

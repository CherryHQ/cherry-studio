---
name: convert-htmx-pdf
description: >
  Convert a branded HTML/HTMX artifact into a paginated, print-correct PDF via
  headless Chromium — with embedded fonts, a running header and page numbers,
  pagination discipline that prevents orphaned pages and split components, and
  a verification loop that proves the output before it ships.
---

# Convert HTMX to Paginated PDF

Deterministic HTML → PDF conversion that preserves the browser rendering. Chromium is the
renderer, because it is the only engine that reproduces modern CSS — grid, flexbox,
`print-color-adjust`, and web fonts — the same way the artifact was authored.

**Do not reach for WeasyPrint, pdfkit, or wkhtmltopdf here.** Their CSS support diverges
from the browser in exactly the areas branded artifacts depend on, which defeats the
purpose of converting a designed page.

## Setup

1. Set `artifact_type: pdf`
2. Set `content_type: direct:pdf`
3. Source HTML must exist and be self-contained (inline CSS/JS, `data:` URLs for images)
4. Playwright + Chromium must be available — the script resolves the binary and reports
   the install command if it is not

## User Input

The user will provide: $ARGUMENTS

Parse for:

- `--source <path-to-html>` (required)
- `--output <path-to-pdf>` (required)
- `--format Letter|A4|Legal|Tabloid` (optional; default `Letter`)
- `--landscape` (optional)
- `--margin <css-length>` (optional; default `0.62in`. Top is raised to `0.72in`
  automatically when the header is enabled, so it has room to draw)
- `--header-left <text>` / `--header-right <text>` (optional; enables the running header)
- `--footer-left <text>` (optional; page numbers always occupy footer-right)
- `--no-header-footer` (optional; suppresses both)
- `--embed-fonts` (optional; default on — see Font Embedding)
- `--no-inject-print-css` (optional; disables the baseline print stylesheet)
- `--print-css <path>` (optional; an additional print stylesheet appended after the baseline)
- `--preview <path-to-png>` (optional; rasterizes page 1 for visual verification)
- `--verify` (optional; default on — see Verification)

## Procedure

Dispatch to the orchestration script:

```bash
node scripts/convert-htmx-pdf.mjs \
  --source "${SOURCE}" \
  --output "${OUTPUT}" \
  --format "${FORMAT:-Letter}" \
  ${HEADER_LEFT:+--header-left "${HEADER_LEFT}"} \
  ${HEADER_RIGHT:+--header-right "${HEADER_RIGHT}"} \
  ${FOOTER_LEFT:+--footer-left "${FOOTER_LEFT}"} \
  --preview "${PREVIEW:-/tmp/pdf-page-1.png}"
```

The script runs five stages in order. Each one exists because skipping it produced a
visibly wrong PDF at least once.

### Stage 1 — Font embedding

External font loads are a render-time dependency, and a PDF built against a missing font
substitutes silently. Substitution changes glyph widths, which changes line breaks, which
changes pagination — so the PDF stops matching the artifact.

The script finds `fonts.googleapis.com` `<link>` tags, fetches the CSS with a browser
user-agent, keeps only the `@font-face` blocks whose `unicode-range` covers Latin or
Latin Extended, downloads each `woff2`, base64-inlines it as a `data:` URI, and replaces
the `<link>` with an inline `<style>`.

Dropping the non-Latin subsets matters — the unfiltered Inter + Roboto Slab + JetBrains
Mono set is 74 `@font-face` blocks and roughly 4 MB. Filtered, it is 22 blocks and
~1.4 MB, and the rendered output is identical for Latin text.

Fonts already inlined as `data:` URIs, or referenced by local path, are left alone.

### Stage 2 — Print stylesheet injection

A baseline `@media print` block is appended to the document. It is deliberately
conservative — it fixes what is always wrong and touches nothing else:

- Hides fixed navigation and sticky sidebars, which otherwise print on every page or
  overlap the running header
- Collapses multi-column page shells to a single column
- `break-inside: avoid` on callouts, tables, figures, cards, list items and code blocks
- `break-after: avoid` on headings, so a heading cannot be orphaned from its content
- `orphans: 3; widows: 3` on paragraphs and list items
- `thead { display: table-header-group }`, so long tables repeat their header
- `-webkit-print-color-adjust: exact`, so brand backgrounds survive

It does **not** insert page breaks. Break placement is a per-artifact decision and belongs
in `--print-css`. See `references/print-pagination.md` for the canonical patterns and the
three failure modes.

### Stage 3 — Preflight

Static checks against the source before rendering. These catch the errors that are
expensive to diagnose from the finished PDF:

| Check | Why |
|---|---|
| `@page { margin: … }` present while header/footer is enabled | **The CSS wins.** A margin in `@page` overrides the margins passed to the renderer, so the header draws into the text. The script strips the declaration and warns. |
| `break-before: page` on more than a third of top-level sections | Forcing every section onto a fresh page produces near-empty pages wherever the previous section ends early. Warned, not blocked. |
| Unbalanced code fences or unclosed tags | A malformed document paginates unpredictably |
| External `<img src="http…">` or `<link rel="stylesheet">` remaining | Render-time network dependency; the PDF is not reproducible |

### Stage 4 — Render

Chromium via Playwright, `emulate_media('print')`, `printBackground: true`.

When a header or footer is requested the script uses Chromium's `headerTemplate` /
`footerTemplate`, which draw inside the page margin on every page. The footer carries
`<span class="pageNumber"></span> / <span class="totalPages"></span>` on the right.

Templates use system fonts only. Chromium renders header and footer in a separate
document that does not inherit the page's `@font-face` rules, so a branded font in a
template silently falls back — and the mismatch is visible.

### Stage 5 — Verification

Never declare a PDF finished without looking at it. The script runs four checks and
writes a preview PNG of page 1:

| Check | Fails when |
|---|---|
| **Content preservation** | Extracted PDF text is under 90% of the source's visible word count — indicates clipped or dropped content |
| **Page density** | Any page below a word threshold (default 40, excluding the first and last) — indicates an orphan page from an over-aggressive break |
| **Font embedding** | `pdffonts` reports a font with `emb: no` — indicates a substitution |
| **Text extraction** | Zero extractable words — indicates the page rendered as images |

Open the preview and confirm it before reporting success. Density numbers catch structural
faults; they do not catch a diagram rendering at the wrong scale.

## Default Constraints

- Output is a **single paginated PDF**, page size and orientation as requested
- Fonts are **embedded**, not referenced
- Backgrounds and brand colors are **preserved** (`printBackground` on)
- Text is **selectable and searchable** — never a raster dump
- Header and footer are drawn by the renderer, not by document content, so they repeat on
  every page without occupying flow
- The baseline print stylesheet **adds no page breaks** — break placement stays with the artifact

## Composition with Other Skills

```
Markdown → convert-md-to-htmx → branded HTML
                                     ↓
                        (optional) rebrand-artifact
                                     ↓
                          convert-htmx-pdf → paginated PDF
```

`refine-validate` may be run against the HTML before conversion. Conversion does not fix a
document whose structure is wrong; it makes the structure visible one page at a time.

## Output Contract

```yaml
artifact_type: pdf
content_type: direct:pdf
outputs:
  - path: <output>.pdf
    description: Paginated, print-correct PDF with embedded fonts
  - path: <preview>.png
    description: Page 1 raster for visual verification
constraints_satisfied:
  - rendered_via_headless_chromium
  - fonts_embedded_base64_latin_subset
  - print_backgrounds_preserved
  - running_header_and_page_numbers
  - pagination_discipline_applied
  - verification_loop_passed
```

## Failure Modes

Three that cost a rebuild each. All three are now checked, and all three are worth
knowing because they present as design problems rather than configuration problems.

**Content collides with the running header.** Symptom: the first line of every page
overlaps the header text. Cause: `@page { margin: 0 }` in the artifact's print CSS, which
overrides the renderer's margins. Fix: keep `@page` to `size` only and let the renderer own
margins. Preflight strips this automatically.

**A page renders nearly blank.** Symptom: a page containing a heading and nothing else, or
three lines of a paragraph. Cause: `break-before: page` on a section whose predecessor
ended near the top of a page. Fix: restrict forced breaks to genuine structural
boundaries — a cover, a major part division, back matter — and let everything else flow.
Page-density verification catches this.

**Type looks subtly wrong and line breaks differ from the browser.** Cause: a font failed
to load and Chromium substituted. Fix: embed the fonts. `pdffonts` verification catches it.

## References

- `scripts/convert-htmx-pdf.mjs` — orchestration script
- `references/print-pagination.md` — canonical print stylesheet, break placement patterns,
  cover-page recipe, and the header/footer template contract

---
name: refine-logo
description: >
  Quick-start logo and brand system refinement. Use when the user wants to
  create or refine a logo, brand identity, icons, wordmarks, or favicon sets.
---

# Refine Logo

Invoke the PMPO artifact refinement loop for **logo and brand system** artifacts.

## Setup

1. Set `artifact_type: logo`
2. Load domain adapter from `references/domain/logo.md`
3. Load template from `assets/templates/logo-showcase.template.html`
4. Start the PMPO loop via `prompts/meta-controller.md`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- Brand name or identity description
- Color preferences (if any)
- Style direction (modern, classic, minimal, etc.)
- Required variants (icon, wordmark, favicon, etc.)
- Background requirements (light, dark, transparent)

If a brand guide file exists or is provided, load it during the Specify phase.

## Default Constraints

If the user doesn't specify, apply these defaults:

- Generate SVG source + PNG set (16, 32, 48, 64, 128, 192, 256, 512)
- Generate icon, wordmark, and app icon variants
- Generate showcase HTML from template
- Validate all outputs against manifest schema

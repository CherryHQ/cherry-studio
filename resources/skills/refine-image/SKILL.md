---
name: refine-image
description: >
  Quick-start image artifact refinement. Use when the user wants to
  create or refine image assets, thumbnails, or visual content.
---

# Refine Image

Invoke the PMPO artifact refinement loop for **image** artifacts.

## Setup

1. Set `artifact_type: image`
2. Load domain adapter from `references/domain/image.md`
3. No default template — images have domain-specific output formats
4. Start the PMPO loop via `prompts/meta-controller.md`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- Image type (photo, illustration, thumbnail, banner)
- Target dimensions and formats (PNG, JPEG, WebP, SVG)
- Color palette or brand alignment
- Composition requirements
- Performance constraints (file size, compression)

## Default Constraints

- Generate at minimum one optimized output format
- Validate file dimensions match specification
- Validate file size is reasonable (< 5MB for web assets)
- Write all outputs to `dist/`
- Update manifest with generated files

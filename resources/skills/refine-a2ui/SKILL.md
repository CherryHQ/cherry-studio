---
name: refine-a2ui
description: >
  Quick-start A2UI specification refinement. Use when the user wants to
  create or refine A2UI (Artifact-to-UI) protocol specifications.
---

# Refine A2UI

Invoke the PMPO artifact refinement loop for **A2UI specification** artifacts.

## Setup

1. Set `artifact_type: a2ui`
2. Load domain adapter from `references/domain/a2ui.md`
3. Load template from `assets/templates/a2ui-preview-template.html`
4. Start the PMPO loop via `prompts/meta-controller.md`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- A2UI component or specification name
- Schema requirements (JSON Schema, TypeScript types)
- Structural integrity needs
- Normalization rules
- Preview rendering requirements

## Default Constraints

- Validate A2UI spec structural integrity
- Ensure schema compliance
- Normalize field naming conventions
- Generate preview HTML using template
- Update manifest with specification files

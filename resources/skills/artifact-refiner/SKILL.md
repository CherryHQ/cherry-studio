---
name: artifact-refiner
description: >
  Use this skill when creating or iteratively refining artifacts (logos, UI components,
  A2UI specifications, images, or content) using structured PMPO orchestration with
  explicit constraints, deterministic execution, and persistent artifact state.
---

# Artifact Refiner — Claude Plugin Adapter

This is the Claude plugin entry point. It delegates to the canonical PMPO skill definition.

## When To Use This Skill

Use when the user asks for structured, iterative refinement of:

- Logos and brand artifacts
- React/HTML UI components
- A2UI specifications
- Image assets
- Content artifacts (Markdown, HTML)

## Source Of Truth

Load these files in order when this skill activates:

1. Root `SKILL.md` — Canonical PMPO behavior, inputs/outputs, execution model
2. `prompts/meta-controller.md` — Orchestration entry point
3. Phase controllers in `prompts/` — `specify.md`, `plan.md`, `execute.md`, `reflect.md`, `persist.md`
4. Domain adapters in `references/domain/` — Domain-specific refinement knowledge
5. Schemas in `references/schemas/` — `artifact-manifest.schema.json`, `constraints.schema.json`

## Non-Negotiable Runtime Contract

- **Persist state** to disk: `artifact_manifest.json`, `constraints.json`, `refinement_log.md`, `decisions.md`, `dist/`
- **Use deterministic execution** for measurable requirements (code interpreter or e2b sandbox)
- **Validate outputs** against schema contracts before termination
- **Never rely on conversational context** for state

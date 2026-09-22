---
name: refine-ui
description: >
  Quick-start React/HTML UI component refinement. Use when the user wants to
  create or refine UI components, design systems, or interactive interfaces.
---

> **Note — one referenced asset is absent.** This skill names
> `assets/templates/react-components-shadcn-ui-template.ts`, which **does not exist in the upstream
> source pack either** — verified against
> `prometheus-skill-pack/skills/imported/artifact-refiner`. It is a dangling reference upstream, not a
> carry omission, and was found by this project's carried-payload test rather than by reading.
>
> The rest of the skill works. Treat the template reference as documentation of an intended asset:
> supply your own component template, or ignore that step.

# Refine UI

Invoke the PMPO artifact refinement loop for **UI component** artifacts.

## Setup

1. Set `artifact_type: ui`
2. Load domain adapter from `references/domain/ui.md`
3. Load template from `assets/templates/react-components-shadcn-ui-template.tsx`
4. Start the PMPO loop via `prompts/meta-controller.md`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- Component type (button, form, card, layout, etc.)
- Framework preference (React, HTML, Vue, etc.)
- Design system (shadcn/ui, Material, custom)
- Accessibility requirements
- Responsive breakpoints

## Default Constraints

- Use semantic HTML elements
- Follow WCAG 2.1 AA accessibility guidelines
- Include responsive styles for mobile, tablet, and desktop
- Generate TypeScript types if React components
- Validate component renders without errors

# No-Reference Mode

Use this mode when the user needs a new Cherry Studio marketing screenshot but has no image to reproduce. The goal is not broad page coverage. One screenshot should prove one product claim clearly enough that a website visitor understands it within about three seconds.

## Write the capture brief

Record this before operating the client:

```text
Feature:
Website claim:
Viewer should understand:
Primary proof state:
Must show:
Supporting context:
Exclude:
Locale/theme variants:
Native output dimensions:
Semantic acceptance markers:
```

The claim must be concrete and visually provable. Replace vague claims such as “powerful Agent” with evidence such as “Agent accepts a task, completes it, and produces a usable file.”

## Choose a proof scene

- Prefer a completed, content-rich, realistic state over a landing page, empty state, setup screen, loading state, or generic welcome message.
- Show both action and consequence when the feature is a workflow. For Chat and Agent, keep the request and meaningful result or artifact in the same frame.
- For selection and browsing features, show a selected object plus distinctive populated content that proves the selection changed.
- For configuration features, show the service identity, meaningful controls, and current status while keeping all credentials masked.
- For creation features, show the full-quality result plus enough prompt, model, history, or tool context to explain how it was made.
- For editors, mini-apps, and workspaces, show meaningful authored content or a running preview plus the key controls that establish the feature.
- Reuse real successful outputs and existing assets. Do not generate a lookalike, edit the DOM, or rerun costly work when a suitable truthful state already exists.

## Compose the frame

- Make the primary proof the largest and strongest visual region. Navigation and top tabs should establish Cherry Studio context without competing with it.
- Keep only supporting UI. Close unrelated files panels, inspectors, menus, tooltips, toasts, and expanded navigation branches.
- Preserve enough product chrome for recognizability, but avoid showing so much navigation that the feature becomes small.
- Ensure essential labels, input, output, and artifacts remain readable at the screenshot's intended website display size.
- Avoid clipped results, large accidental blank areas, awkward scroll cutoffs, and ambiguous selection states.
- Use one stable compositional grammar across the series: native dimensions, window chrome, zoom, top-tab order, sidebar width, and feature-tab position.
- Let the feature determine the hero content; consistency should not force every page into an identical internal layout.

## Build the locale and theme matrix

Treat every locale/theme variant as an independent product state, not as a mechanical toggle:

- All visible product UI, current content, sidebar labels, placeholders, task/result copy, and surrounding tabs must use the target locale.
- Brand names, model names, filenames, code, and standardized technical identifiers may remain unchanged.
- Recheck selection, scroll offset, contrast, hover state, image zoom, chart controls, and nested panels after every theme or route remount.
- Keep the accepted scene, dimensions, information hierarchy, and proof markers consistent across variants.

## Apply three acceptance gates

### 1. Semantic gate

- The feature and its value are understandable within about three seconds.
- The screenshot visibly proves the claim rather than merely showing that the page exists.
- Required input, completed result, selected content, status, or artifact markers are present.
- No unrelated personal content changes the story.

### 2. Composition gate

- The proof state dominates the frame and is readable at website display size.
- Supporting navigation is sufficient but visually secondary.
- No incidental panel, empty space, crop, hover state, or scroll position weakens the hierarchy.
- A viewer does not need prior product knowledge to know where to look.

### 3. Production gate

- Native dimensions, aspect ratio, scaling, color mode, Alpha, title bar, traffic lights, and transparent corners meet the delivery contract.
- Locale and theme are complete and internally consistent.
- The exact main Electron window was captured; loading, menus, tooltips, toasts, and cursor hover are absent unless intentionally part of the claim.
- Secrets are masked and unrelated private information is absent.

Passing one gate cannot compensate for failing another. Pixel metrics cannot validate a no-reference composition.

## Review the sample and the set

Capture one representative sample before expanding a no-reference website batch unless the user explicitly asks for uninterrupted delivery. Present the sample with the product claim it is intended to prove. After approval, lock its dimensions and compositional grammar.

For the completed matrix, create a contact sheet and inspect it as a set. Verify that:

- the same feature claim survives every locale/theme variant
- visual weight, crop, zoom, and surrounding tabs remain consistent
- no single image is an empty, noisy, or structurally different outlier
- each feature has a distinct hero scene while still belonging to the same product family

Recapture any image that passes file-level checks but fails this set-level review.

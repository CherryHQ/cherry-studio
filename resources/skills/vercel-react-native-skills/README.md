# React Native Guidelines

A structured repository for creating and maintaining React Native Best Practices
optimized for agents and LLMs.

## Structure

- `rules/` - Individual rule files (one per rule)
  - `_sections.md` - Section metadata (titles, impacts, descriptions)
  - `_template.md` - Template for creating new rules
  - `area-description.md` - Individual rule files
- `metadata.json` - Document metadata (version, organization, abstract)
- **`AGENTS.md`** - Compiled output (generated)

## Rules

### Core Rendering (CRITICAL)

- `rendering-text-in-text-component.md` - Wrap strings in Text components
- `rendering-no-falsy-and.md` - Avoid falsy && operator in JSX

### List Performance (HIGH)

- `list-performance-virtualize.md` - Use virtualized lists (LegendList,
  FlashList)
- `list-performance-function-references.md` - Keep stable object references
- `list-performance-callbacks.md` - Hoist callbacks to list root
- `list-performance-inline-objects.md` - Avoid inline objects in renderItem
- `list-performance-item-memo.md` - Pass primitives for memoization
- `list-performance-item-expensive.md` - Keep list items lightweight
- `list-performance-images.md` - Use compressed images in lists
- `list-performance-item-types.md` - Use item types for heterogeneous lists

### Animation (HIGH)

- `animation-gpu-properties.md` - Animate transform/opacity instead of layout
- `animation-gesture-detector-press.md` - Use GestureDetector for press
  animations
- `animation-derived-value.md` - Prefer useDerivedValue over useAnimatedReaction

### Scroll Performance (HIGH)

- `scroll-position-no-state.md` - Never track scroll in useState

### Navigation (HIGH)

- `navigation-native-navigators.md` - Use native stack and native tabs

### React State (MEDIUM)

- `react-state-dispatcher.md` - Use functional setState updates
- `react-state-fallback.md` - State should represent user intent only
- `react-state-minimize.md` - Minimize state variables, derive values

### State Architecture (MEDIUM)

- `state-ground-truth.md` - State must represent ground truth

### React Compiler (MEDIUM)

- `react-compiler-destructure-functions.md` - Destructure functions early
- `react-compiler-reanimated-shared-values.md` - Use .get()/.set() for shared
  values

### User Interface (MEDIUM)

- `ui-expo-image.md` - Use expo-image for optimized images
- `ui-image-gallery.md` - Use Galeria for lightbox/galleries
- `ui-menus.md` - Native dropdown and context menus with Zeego
- `ui-native-modals.md` - Use native Modal with formSheet
- `ui-pressable.md` - Use Pressable instead of TouchableOpacity
- `ui-measure-views.md` - Measuring view dimensions
- `ui-safe-area-scroll.md` - Use contentInsetAdjustmentBehavior
- `ui-scrollview-content-inset.md` - Use contentInset for dynamic spacing
- `ui-styling.md` - Modern styling patterns (gap, boxShadow, gradients)

### Design System (MEDIUM)

- `design-system-compound-components.md` - Use compound components

### Monorepo (LOW)

- `monorepo-native-deps-in-app.md` - Install native deps in app directory
- `monorepo-single-dependency-versions.md` - Single dependency versions

### Third-Party Dependencies (LOW)

- `imports-design-system-folder.md` - Import from design system folder

### JavaScript (LOW)

- `js-hoist-intl.md` - Hoist Intl formatter creation

### Fonts (LOW)

- `fonts-config-plugin.md` - Load fonts natively at build time

## Creating a New Rule

1. Copy `rules/_template.md` to `rules/area-description.md`
2. Choose the appropriate area prefix:
   - `rendering-` for Core Rendering
   - `list-performance-` for List Performance
   - `animation-` for Animation
   - `scroll-` for Scroll Performance
   - `navigation-` for Navigation
   - `react-state-` for React State
   - `state-` for State Architecture
   - `react-compiler-` for React Compiler
   - `ui-` for User Interface
   - `design-system-` for Design System
   - `monorepo-` for Monorepo
   - `imports-` for Third-Party Dependencies
   - `js-` for JavaScript
   - `fonts-` for Fonts
3. Fill in the frontmatter and content
4. Ensure you have clear examples with explanations

## Rule File Structure

Each rule file should follow this structure:

````markdown
---
title: Rule Title Here
impact: MEDIUM
impactDescription: Optional description
tags: tag1, tag2, tag3
---

## Rule Title Here

Brief explanation of the rule and why it matters.

**Incorrect (description of what's wrong):**

```tsx
// Bad code example
```
````

**Correct (description of what's right):**

```tsx
// Good code example
```

Reference: [Link](https://example.com)

```

## File Naming Convention

- Files starting with `_` are special (excluded from build)
- Rule files: `area-description.md` (e.g., `animation-gpu-properties.md`)
- Section is automatically inferred from filename prefix
- Rules are sorted alphabetically by title within each section

## Impact Levels

- `CRITICAL` - Highest priority, causes crashes or broken UI
- `HIGH` - Significant performance improvements
- `MEDIUM` - Moderate performance improvements
- `LOW` - Incremental improvements
```

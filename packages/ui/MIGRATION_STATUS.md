# Cherry Studio UI Migration Plan

## Overview

This document outlines the detailed plan for migrating Cherry Studio from antd + styled-components to shadcn/ui + Tailwind CSS. We will adopt a progressive migration strategy to ensure system stability and development efficiency, while gradually implementing UI refactoring in collaboration with UI designers.

## Migration Strategy

### Target Tech Stack

- **UI Component Library**: shadcn/ui (replacing antd and previously migrated HeroUI)
- **Styling Solution**: Tailwind CSS v4 (replacing styled-components)
- **Design System**: Custom CSS variable system (`--cs-*` namespace)
- **Theme System**: CSS variables + Tailwind CSS theme

### Migration Principles

1. **Backward Compatibility**: Old components continue working until new components are fully available
2. **Progressive Migration**: Migrate components one by one to avoid large-scale rewrites
3. **Feature Parity**: Ensure new components have all the functionality of old components
4. **Design Consistency**: Follow new design system specifications (see [README.md](./README.md))
5. **Performance Priority**: Optimize bundle size and rendering performance
6. **Designer Collaboration**: Work with UI designers for gradual component encapsulation and UI optimization

## Usage Example

```typescript
// Import components from @cherrystudio/ui
import { Spinner, DividerWithText, InfoTooltip } from '@cherrystudio/ui'

// Use in components
function MyComponent() {
  return (
    <div>
      <Spinner size={24} />
      <DividerWithText text="Divider Text" />
      <InfoTooltip content="Tooltip message" />
    </div>
  )
}
```

## Directory Structure

```text
@packages/ui/
├── src/
│   ├── components/         # Main components directory
│   │   ├── primitives/     # Basic/primitive components (Avatar, ErrorBoundary, Selector, etc.)
│   │   │   └── shadcn-io/  # shadcn/ui components (dropzone, etc.)
│   │   ├── icons/          # Icon components (Icon, FileIcons, etc.)
│   │   └── composites/     # Composite components (CodeEditor, ListItem, etc.)
│   ├── hooks/              # Custom React Hooks
│   ├── styles/             # Global styles and CSS variables
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Utility functions
│   └── index.ts            # Main export file
```

### Component Classification Guide

When submitting PRs, please place components in the correct directory based on their function:

- **primitives**: Basic and primitive UI elements, shadcn/ui components
  - `Avatar`: Avatar components
  - `ErrorBoundary`: Error boundary components
  - `Selector`: Selection components
  - `shadcn-io/`: Direct shadcn/ui components or adaptations
- **icons**: All icon-related components
  - `Icon`: Icon factory and basic icons
  - `FileIcons`: File-specific icons
  - Loading/spinner icons (SvgSpinners180Ring, ToolsCallingIcon, etc.)
- **composites**: Complex components made from multiple primitives
  - `CodeEditor`: Code editing components
  - `ListItem`: List item components
  - `ThinkingEffect`: Animation components
  - Form and interaction components (DraggableList, EditableNumber, etc.)

## Component Extraction Criteria

### Extraction Standards

1. **Usage Frequency**: Component is used in ≥ 3 places in the codebase
2. **Future Reusability**: Expected to be used in multiple scenarios in the future
3. **Business Complexity**: Component contains complex interaction logic or state management
4. **Maintenance Cost**: Centralized management can reduce maintenance overhead
5. **Design Consistency**: Components that require unified visual and interaction experience
6. **Test Coverage**: As common components, they facilitate unit test writing and maintenance

### Extraction Principles

- **Single Responsibility**: Each component should only handle one clear function
- **Highly Configurable**: Provide flexible configuration options through props
- **Backward Compatible**: New versions maintain API backward compatibility
- **Complete Documentation**: Provide clear API documentation and usage examples
- **Type Safety**: Use TypeScript to ensure type safety

### Cases Not Recommended for Extraction

- Simple display components used only on a single page
- Overly customized business logic components
- Components tightly coupled to specific data sources

## Migration Steps

| Phase | Status | Main Tasks | Description |
| --- | --- | --- | --- |
| **Phase 1** | ✅ **Completed** | **Design System Integration** | • Converted design tokens from todocss.css to tokens.css with `--cs-*` namespace<br>• Created theme.css mapping all design tokens to standard Tailwind classes<br>• Extended Tailwind with semantic spacing (5xs~8xl) and radius (4xs~3xl) systems<br>• Established two usage modes: full override and selective override<br>• Cleaned up main package's conflicting Shadcn theme definitions |
| **Phase 2** | ⏳ **To Start** | **Component Migration and Optimization** | • Filter components for migration based on extraction criteria<br>• Remove antd dependencies, replace with shadcn/ui<br>• Remove HeroUI dependencies, replace with shadcn/ui<br>• Remove styled-components, replace with Tailwind CSS + design system variables<br>• Optimize component APIs and type definitions |
| **Phase 3** | ⏳ **To Start** | **UI Refactoring and Optimization** | • Gradually implement UI refactoring with UI designers<br>• Ensure visual consistency and user experience<br>• Performance optimization and code quality improvement |

## Notes

1. **Do NOT migrate** components with these dependencies (can be migrated after decoupling):
   - window.api calls
   - Redux (useSelector, useDispatch, etc.)
   - Other external data sources

2. **Can migrate** but need decoupling later:
   - Components using i18n (change i18n to props)
   - Components using antd (replace with shadcn/ui later)
   - Components using HeroUI (replace with shadcn/ui later)

3. **Submission Guidelines**:
   - Each PR should focus on one category of components
   - Ensure all migrated components are exported
   - Follow component extraction criteria, only migrate qualified components

## Design System Integration

### CSS Variable System

- All design tokens use `--cs-*` namespace (e.g., `--cs-primary`, `--cs-red-500`)
- Complete color palette: 17 colors × 11 shades each
- Semantic spacing system: `5xs` through `8xl` (16 levels)
- Semantic radius system: `4xs` through `3xl` plus `round` (11 levels)
- Full light/dark mode support
- See [README.md](./README.md) for usage documentation

### Migration Priority Adjustment

1. **High Priority**: Basic components (buttons, inputs, tags, etc.)
2. **Medium Priority**: Display components (cards, lists, tables, etc.)
3. **Low Priority**: Composite components and business-coupled components

### UI Designer Collaboration

- All component designs need confirmation from UI designers
- Gradually implement UI refactoring to maintain visual consistency
- New components must comply with design system specifications

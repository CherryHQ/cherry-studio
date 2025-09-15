# UI Component Library Migration Status

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
│   │   ├── base/           # Basic components (buttons, inputs, labels, etc.)
│   │   ├── display/        # Display components (cards, lists, tables, etc.)
│   │   ├── layout/         # Layout components (containers, grids, spacing, etc.)
│   │   ├── icons/          # Icon components
│   │   ├── interactive/    # Interactive components (modals, tooltips, dropdowns, etc.)
│   │   └── composite/      # Composite components (made from multiple base components)
│   ├── hooks/              # Custom React Hooks
│   └── types/              # TypeScript type definitions
```

### Component Classification Guide

When submitting PRs, please place components in the correct directory based on their function:

- **base**: Most basic UI elements like buttons, inputs, switches, labels, etc.
- **display**: Components for displaying content like cards, lists, tables, tabs, etc.
- **layout**: Components for page layout like containers, grid systems, dividers, etc.
- **icons**: All icon-related components
- **interactive**: Components requiring user interaction like modals, drawers, tooltips, dropdowns, etc.
- **composite**: Composite components made from multiple base components

## Migration Overview

- **Total Components**: 236
- **Migrated**: 26
- **Refactored**: 0
- **Pending Migration**: 210

## Component Status Table

| Category | Component Name | Migration Status | Refactoring Status | Description |
|----------|----------------|------------------|--------------------|-------------|
| **base** | | | | Base components |
| | CopyButton | ✅ | ❌ | Copy button |
| | CustomTag | ✅ | ❌ | Custom tag |
| | DividerWithText | ✅ | ❌ | Divider with text |
| | EmojiIcon | ✅ | ❌ | Emoji icon |
| | ErrorTag | ✅ | ❌ | Error tag |
| | IndicatorLight | ✅ | ❌ | Indicator light |
| | Spinner | ✅ | ❌ | Loading spinner |
| | SuccessTag | ✅ | ❌ | Success tag |
| | TextBadge | ✅ | ❌ | Text badge |
| | WarnTag | ✅ | ❌ | Warning tag |
| | CustomCollapse | ❌ | ❌ | Custom collapse panel |
| **display** | | | | Display components |
| | Ellipsis | ✅ | ❌ | Text ellipsis |
| | ExpandableText | ✅ | ❌ | Expandable text |
| | ThinkingEffect | ✅ | ❌ | Thinking effect animation |
| | CodeViewer | ❌ | ❌ | Code viewer (external deps) |
| | OGCard | ❌ | ❌ | OG card |
| | MarkdownShadowDOMRenderer | ❌ | ❌ | Markdown renderer |
| | Preview/* | ❌ | ❌ | Preview components |
| **layout** | | | | Layout components |
| | HorizontalScrollContainer | ✅ | ❌ | Horizontal scroll container |
| | Scrollbar | ✅ | ❌ | Scrollbar |
| | Layout/* | ❌ | ❌ | Layout components |
| | Tab/* | ❌ | ❌ | Tab (Redux dependency) |
| | TopView | ❌ | ❌ | Top view (window.api dependency) |
| **icons** | | | | Icon components |
| | CopyIcon | ✅ | ❌ | Copy icon |
| | DeleteIcon | ✅ | ❌ | Delete icon |
| | EditIcon | ✅ | ❌ | Edit icon |
| | FileIcons | ✅ | ❌ | File icons (includes FileSvgIcon, FilePngIcon) |
| | ReasoningIcon | ✅ | ❌ | Reasoning icon |
| | RefreshIcon | ✅ | ❌ | Refresh icon |
| | SvgSpinners180Ring | ✅ | ❌ | Spinners icon |
| | ToolsCallingIcon | ✅ | ❌ | Tools calling icon |
| | VisionIcon | ✅ | ❌ | Vision icon |
| | WebSearchIcon | ✅ | ❌ | Web search icon |
| | Other icons | ❌ | ❌ | Other icon files |
| **interactive** | | | | Interactive components |
| | InfoTooltip | ✅ | ❌ | Info tooltip |
| | HelpTooltip | ❌ | ❌ | Help tooltip |
| | WarnTooltip | ❌ | ❌ | Warning tooltip |
| | DraggableList | ❌ | ❌ | Draggable list |
| | EditableNumber | ❌ | ❌ | Editable number |
| | EmojiPicker | ❌ | ❌ | Emoji picker |
| | Selector | ❌ | ❌ | Selector |
| | ModelSelector | ❌ | ❌ | Model selector (Redux dependency) |
| | LanguageSelect | ❌ | ❌ | Language select |
| | TranslateButton | ❌ | ❌ | Translate button (window.api dependency) |
| **composite** | | | | Composite components |
| | - | - | - | No composite components yet |
| **Uncategorized** | | | | Components needing categorization |
| | Popups/* (16+ files) | ❌ | ❌ | Popup components (business coupled) |
| | RichEditor/* (30+ files) | ❌ | ❌ | Rich text editor |
| | CodeEditor/* | ❌ | ❌ | Code editor |
| | MarkdownEditor/* | ❌ | ❌ | Markdown editor |
| | MinApp/* | ❌ | ❌ | Mini app (Redux dependency) |
| | Avatar/* | ❌ | ❌ | Avatar components |
| | ActionTools/* | ❌ | ❌ | Action tools |
| | CodeBlockView/* | ❌ | ❌ | Code block view (window.api dependency) |
| | ContextMenu | ❌ | ❌ | Context menu (Electron API) |
| | WindowControls | ❌ | ❌ | Window controls (Electron API) |
| | ErrorBoundary | ❌ | ❌ | Error boundary (window.api dependency) |

## Migration Steps

### Phase 1: Copy Migration (Current Phase)

- Copy components as-is to @packages/ui
- Retain original dependencies (antd, styled-components, etc.)
- Add original path comment at file top

### Phase 2: Refactor and Optimize

- Remove antd dependencies, replace with HeroUI
- Remove styled-components, replace with Tailwind CSS
- Optimize component APIs and type definitions

## Notes

1. **Do NOT migrate** components with these dependencies (can be migrated after decoupling):
   - window.api calls
   - Redux (useSelector, useDispatch, etc.)
   - Other external data sources

2. **Can migrate** but need decoupling later:
   - Components using i18n (change i18n to props)
   - Components using antd (replace with HeroUI later)

3. **Submission Guidelines**:
   - Each PR should focus on one category of components
   - Ensure all migrated components are exported
   - Update migration status in this document
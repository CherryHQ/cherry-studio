# UI Refactor: Tailwind CSS + shadcn/ui Migration

---

created: 2025-01-27T19:30:00Z
updated: 2025-01-27T19:30:00Z
updatedBy: v0-AI-Assistant
version: 1.0.0
branch: feature/ui-refactor-tailwind-shadcn

---

## Project Overview

**Objective**: Migrate Cockpit Electron UI from SCSS + styled-components + Ant Design to Tailwind CSS + shadcn/ui

**Timeline**: 8 weeks (January 27 - March 24, 2025)

**Branch**: `feature/ui-refactor-tailwind-shadcn`

## Current State Analysis

### Existing Architecture

- **Framework**: Electron + Vite + React 19 + TypeScript
- **Styling**: Mixed approach with SCSS, styled-components, and Ant Design
- **Theme System**: Custom CSS variables with dark/light/system modes
- **Component Library**: Primarily Ant Design with custom styled-components

### Key Files Analyzed

- `src/renderer/src/assets/styles/` - SCSS styling system
- `src/renderer/src/context/ThemeProvider.tsx` - Theme management
- `src/renderer/src/context/AntdProvider.tsx` - Ant Design integration
- `src/renderer/src/App.tsx` - Provider stack configuration

## Migration Strategy

### Phase 1: Foundation Setup (Week 1)

**Goal**: Install and configure Tailwind CSS + shadcn/ui

**Tasks**:

- [ ] Install Tailwind CSS v4 with Vite integration
- [ ] Install shadcn/ui core dependencies
- [ ] Configure Vite for Tailwind processing
- [ ] Initialize shadcn/ui with `npx shadcn@latest init`
- [ ] Create Tailwind configuration mapping existing CSS variables
- [ ] Set up path aliases for component imports

**Dependencies to Install**:

```bash
npm install tailwindcss@latest @tailwindcss/vite@latest
npm install class-variance-authority clsx tailwind-merge lucide-react
npm install @types/node
```

### Phase 2: Theme System Migration (Week 2)

**Goal**: Migrate existing theme system to work with Tailwind

**Tasks**:

- [ ] Create enhanced ThemeProvider compatible with shadcn/ui
- [ ] Map existing CSS variables to Tailwind theme tokens
- [ ] Configure dark mode with class-based strategy
- [ ] Integrate with Electron's native theme detection
- [ ] Test theme switching functionality

### Phase 3: Component Migration (Weeks 3-6)

**Goal**: Gradually migrate components from styled-components to shadcn/ui

**Week 3 - Core UI Components**:

- [ ] Button components (ToolbarButton, etc.)
- [ ] Input components (InputBar, etc.)
- [ ] Basic form elements

**Week 4 - Layout Components**:

- [ ] Sidebar navigation
- [ ] TabBar and TabContentManager
- [ ] Main layout structure

**Week 5 - Complex Components**:

- [ ] Message components
- [ ] Settings pages
- [ ] Popup/Modal components

**Week 6 - Specialized Components**:

- [ ] CodeBlock and syntax highlighting
- [ ] Markdown rendering
- [ ] File handling components

### Phase 4: Coexistence Strategy (Ongoing)

**Goal**: Maintain both systems during transition

**Approach**:

- Keep existing AntdProvider during migration
- Use component aliasing for smooth transition
- Gradual replacement without breaking functionality
- Feature flags for testing new components

### Phase 5: Advanced Integration (Weeks 7-8)

**Goal**: Polish and optimize the new system

**Tasks**:

- [ ] Electron-specific adaptations
- [ ] Performance optimization
- [ ] Accessibility improvements
- [ ] Documentation and team training
- [ ] Remove legacy styling systems

## Implementation Guidelines

### Component Migration Pattern

**Before (styled-components)**:

```typescript
const ToolbarButton = styled(Button)`
  width: 30px;
  height: 30px;
  font-size: 16px;
  border-radius: 50%;
  color: var(--color-icon);
  &:hover {
    background-color: var(--color-background-soft);
  }
`
```

**After (shadcn/ui + Tailwind)**:

```typescript
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ToolbarButton({ children, active, onClick, ...props }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "h-[30px] w-[30px] rounded-full text-base text-muted-foreground",
        "hover:bg-muted hover:text-foreground transition-all duration-300",
        active && "bg-primary text-primary-foreground hover:bg-primary"
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </Button>
  )
}
```

### Theme Configuration

**Tailwind Config**:

```javascript
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        background: 'var(--color-background)',
        foreground: 'var(--color-text)'
        // ... complete mapping
      }
    }
  }
}
```

### Provider Stack Update

```typescript
function App() {
  return (
    <Provider store={store}>
      <StyleSheetManager>
        <ThemeProvider defaultTheme="system" storageKey="cockpit-ui-theme">
          <AntdProvider> {/* Keep during transition */}
            <NotificationProvider>
              <CodeStyleProvider>
                <PersistGate loading={null} persistor={persistor}>
                  <AppContent />
                </PersistGate>
              </CodeStyleProvider>
            </NotificationProvider>
          </AntdProvider>
        </ThemeProvider>
      </StyleSheetManager>
    </Provider>
  )
}
```

## Risk Mitigation

1. **Gradual Migration**: Keep both systems running in parallel
2. **Feature Flags**: Use flags to toggle between old/new components
3. **Rollback Plan**: Maintain ability to revert changes
4. **Testing**: Comprehensive testing at each phase
5. **Team Training**: Ensure team understands new patterns

## Success Metrics

- [ ] All components migrated to Tailwind + shadcn/ui
- [ ] Theme switching works correctly in all modes
- [ ] Performance maintained or improved
- [ ] Bundle size optimized
- [ ] Developer experience improved
- [ ] Accessibility standards maintained
- [ ] Documentation complete

## Next Steps

1. **Immediate**: Begin Phase 1 foundation setup
2. **Week 1**: Complete Tailwind and shadcn/ui installation
3. **Week 2**: Migrate theme system
4. **Ongoing**: Follow phased component migration plan

## Resources

- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Vite Integration Guide](https://ui.shadcn.com/docs/installation/vite)
- [Electron + Tailwind Best Practices](https://tailwindcss.com/docs/guides/electron)

---

**Created**: 2025-01-27 by v0-AI-Assistant  
**Branch**: feature/ui-refactor-tailwind-shadcn  
**Status**: Planning Phase - Ready to Begin Implementation

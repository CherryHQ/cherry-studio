# Tab System Visual Mockup & User Flow

## Visual Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  ⚡ Cockpit                                                   - □ x │
├────────────────────────────────────────────────────────────────────────┤
│ ┌───┬──────────────────────────────────────────────────────────────┐  │
│ │   │  🏠 Home  | 🤖 Agents¹ | 📄 Report.pdf | 🤖 Agents² | + │  │
│ │ S ├──────────────────────────────────────────────────────────────┤  │
│ │ I │                                                              │  │
│ │ D │                    Active Tab Content                        │  │
│ │ E │                                                              │  │
│ │ B │                  (Currently showing Agents²)                 │  │
│ │ A │                                                              │  │
│ │ R │                                                              │  │
│ │   │                                                              │  │
│ └───┴──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Tab States & Behaviors

### 1. Tab Appearance States

```
Normal Tab:
┌─────────────┐
│ 📄 Title  x │
└─────────────┘

Active Tab:
┌═════════════┐
║ 📄 Title  x ║  (Bold border, highlighted)
└═════════════┘

Hover State:
┌─────────────┐
│ 📄 Title  ✕ │  (Close button more visible)
└─────────────┘

Pinned Tab:
┌─────┐
│ 📄  │  (No title, no close button)
└─────┘

Loading Tab:
┌─────────────┐
│ ⟳ Loading.. │  (Spinner icon)
└─────────────┘
```

### 2. User Interactions

#### Opening New Tabs

```
Sidebar Click Flow:
┌──────────┐     ┌──────────────┐     ┌─────────────┐
│ Click    │ --> │ Check if     │ --> │ Create New  │
│ Sidebar  │     │ Singleton?   │ NO  │ Tab         │
│ Item     │     └──────────────┘     └─────────────┘
└──────────┘              │                    │
                         YES                   │
                          │                    │
                          ▼                    ▼
                 ┌──────────────┐     ┌─────────────┐
                 │ Focus        │     │ Add to Tab  │
                 │ Existing Tab │     │ Bar         │
                 └──────────────┘     └─────────────┘
```

#### Tab Context Menu

```
Right-click on tab:
┌─────────────────────┐
│ Close              │
│ Close Others       │
│ Close to the Right │
│ ─────────────────  │
│ Pin/Unpin Tab      │
│ Duplicate Tab      │
│ ─────────────────  │
│ Reopen Closed Tab  │
└─────────────────────┘
```

## Tab Types Examples

### 1. Built-in Page Tabs
```
🏠 Home         - Main chat interface
🤖 Agents       - Agent management
🎨 Paintings    - Image generation
🌐 Translate    - Translation tool
📁 Files        - File browser
🧠 Knowledge    - Knowledge base
⚙️ Settings     - App settings (singleton)
```

### 2. MinApp Tabs
```
📚 Docs         - Documentation viewer
🔗 External App - Any web-based tool
📊 Analytics    - Data visualization
📝 Notes        - Note-taking app
```

## Keyboard Shortcuts Visual Guide

```
┌─────────────┬────────────────────────────┐
│ Shortcut    │ Action                     │
├─────────────┼────────────────────────────┤
│ Ctrl+T      │ New tab                    │
│ Ctrl+W      │ Close current tab          │
│ Ctrl+Tab    │ Next tab                   │
│ Ctrl+Shift+Tab │ Previous tab            │
│ Ctrl+1-9    │ Switch to tab N            │
│ Ctrl+Shift+T│ Reopen closed tab          │
│ Middle Click│ Close tab (on tab)         │
│ Ctrl+Click  │ Open in new tab (sidebar)  │
└─────────────┴────────────────────────────┘
```

## Tab Bar Overflow Behavior

```
When many tabs are open:

[< │ 🏠 │ 🤖 │ 📄 │ 🎨 │ ... │ >]
   └─────────────────────────┘
      Scrollable area

With search/filter (future):
┌─────────────────────────────┐
│ 🔍 Search tabs...           │
├─────────────────────────────┤
│ 🏠 Home                     │
│ 🤖 Agents - Config          │
│ 🤖 Agents - Testing         │
│ 📄 Report.pdf               │
└─────────────────────────────┘
```

## Memory Management Indicators

```
Tab with memory warning:
┌─────────────┐
│ 📄 Title ⚠️ │  (High memory usage)
└─────────────┘

Suspended tab:
┌─────────────┐
│ 📄 Title 💤 │  (Inactive, suspended)
└─────────────┘
```

## Tab Drag & Drop

```
Dragging tab:
     ┌─────────────┐
     │ 📄 Moving.. │ ← Dragging
     └─────────────┘
          │
┌────┬────┼────┬────┬────┐
│ 🏠 │ ░░░░░ │ 🤖 │ 📊 │  Drop zone indicator
└────┴────────┴────┴────┘
```

## Split View (Future Enhancement)

```
┌────────────────────────────────────────────┐
│  Tabs: 🏠 | 🤖 | 📄 | 🎨                  │
├────────────────┬───────────────────────────┤
│                │                           │
│   🏠 Home      │    🤖 Agents             │
│   (Left pane)  │    (Right pane)          │
│                │                           │
└────────────────┴───────────────────────────┘
```

## Mobile/Responsive View

```
On smaller screens:
┌─────────────────┐
│ ☰ │ 🏠 Home    │  Hamburger menu for tabs
├─────────────────┤
│                 │
│  Tab Content    │
│                 │
└─────────────────┘

Tab drawer:
┌─────────────────┐
│ Active Tabs     │
├─────────────────┤
│ 🏠 Home        │
│ 🤖 Agents ✓    │ ← Current
│ 📄 Report.pdf  │
│ 🎨 Paintings   │
└─────────────────┘
```

## Implementation Priority

### Phase 1 - Core (Week 1-2)
- Basic tab bar UI
- Open/close/switch tabs
- Redux integration

### Phase 2 - Features (Week 2-3)
- Drag & drop reordering
- Context menu
- Keyboard shortcuts
- State isolation

### Phase 3 - Polish (Week 3-4)
- Animations
- Memory indicators
- Tab search
- Performance optimization

### Phase 4 - Advanced (Future)
- Split view
- Tab groups
- Tab sharing
- Cloud sync
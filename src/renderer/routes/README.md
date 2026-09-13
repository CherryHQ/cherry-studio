# Routing System Developer Guide

This project uses **TanStack Router + Multi MemoryRouter** architecture, where each Tab has its own independent router instance, enabling native KeepAlive behavior.

## Quick Start

### 1. Adding a New Page

Create a file in the `src/renderer/routes/` directory:

```typescript
// routes/knowledge.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/knowledge')({
  component: KnowledgePage
})

function KnowledgePage() {
  return <div>Knowledge Page</div>
}
```

After running `yarn dev`, TanStack Router will automatically update `routeTree.gen.ts`.

### 2. Routes with Parameters

```typescript
// routes/chat/$topicId.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/chat/$topicId')({
  component: ChatPage
})

function ChatPage() {
  const { topicId } = Route.useParams()
  return <div>Chat: {topicId}</div>
}
```

### 3. Nested Routes

```text
routes/
├── settings.tsx        # /settings (layout)
├── settings/
│   ├── general.tsx     # /settings/general
│   └── provider.tsx    # /settings/provider
```

```typescript
// routes/settings.tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsLayout
})

function SettingsLayout() {
  return (
    <div className="flex">
      <aside>Settings Menu</aside>
      <main><Outlet /></main>
    </div>
  )
}
```

## Navigation API

This project provides layout-aware route navigation plus in-workspace navigation:

The main window supports Sidebar-only, Tabs-only, and the legacy combined Sidebar + Tabs layout. The combined layout keeps the pre-change ordinary-tab navigation behavior. Switching from Sidebar-only to Tabs-only exposes the current workspace in the top bar while the other Sidebar workspaces remain in the keep-alive pool. Switching to the combined layout keeps only the current workspace (plus its source when a focused route is active), exposes every retained page as an ordinary tab, and releases the other Sidebar-only workspaces.

### 1. Shell Navigation - `openRoute`

Open an application workspace or a focused page through the shell. `openTab` is a compatibility alias with the same layout-aware behavior.

```typescript
import { useTabs } from '@renderer/hooks/tab'

function MyComponent() {
  const { openRoute, activateWorkspace, closeTab } = useTabs()

  // Sidebar-only: activate the app's unique workspace. Tabs/Both: reuse/create a tab.
  openRoute('/app/knowledge')

  // Explicitly activate a stable Sidebar workspace without replacing its route.
  activateWorkspace('app:assistants', '/app/chat')

  // Streamlined layouts use one focused page for utility routes.
  // The legacy combined layout keeps them as ordinary tabs.
  openRoute('/settings/general')

  // Webviews remain ordinary tabs.
  openRoute('https://example.com', {
    type: 'webview',
    title: 'Example Site'
  })

  // Close Tab
  closeTab(tabId)
}
```

### 2. In-Tab Navigation - `useNavigate`

Navigate within the same Tab (won't create a new Tab) using TanStack Router's `useNavigate`:

```typescript
import { useNavigate } from '@tanstack/react-router'

function SettingsPage() {
  const navigate = useNavigate()

  // Navigate to sub-page within current Tab
  navigate({ to: '/settings/provider' })

  // Navigate with parameters
  navigate({ to: '/chat/$topicId', params: { topicId: '123' } })
}
```

### Comparison

| Scenario | Method | Result |
|----------|--------|--------|
| Open feature module | `openRoute('/app/knowledge')` | Activates its Sidebar-only workspace or opens a Tab |
| Open settings / file preview | `openRoute(...)` | Opens a focused page in the streamlined layouts; the combined layout retains ordinary tabs |
| Switch sub-page in settings | `navigate({ to: '/settings/provider' })` | Navigates within current Tab |
| Switch conversation inside an app | `navigate(...)` | Keeps the app's workspace and component state |
| Go back to previous page | `navigate({ to: '..' })` | Goes back within current Tab |

### API Reference

#### `useTabs()` Return Value

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `tabs` | `Tab[]` | All mounted tabs and background Sidebar workspaces |
| `tabBarTabs` | `Tab[]` | Tabs currently exposed in the top tab bar |
| `activeTabId` | `string` | Currently active Tab ID |
| `activeTab` | `Tab \| undefined` | Currently active Tab object |
| `openRoute(url, options?)` | `(url: string, options?: OpenTabOptions) => string` | Layout-aware navigation; the combined layout preserves legacy tab behavior |
| `openTab(url, options?)` | `(url: string, options?: OpenTabOptions) => string` | Compatibility alias of `openRoute` |
| `activateWorkspace(key, route, options?)` | `(string, string, OpenTabOptions?) => string` | Activate or create one stable workspace |
| `closeFocusedRoute()` | `() => void` | Close the focused page and restore its source workspace |
| `closeTab(id)` | `(id: string) => void` | Close specified Tab |
| `setActiveTab(id)` | `(id: string) => void` | Switch to specified Tab |
| `updateTab(id, updates)` | `(id: string, updates: Partial<Tab>) => void` | Update Tab properties |

#### `OpenTabOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `forceNew` | `boolean` | `false` | Force a new app Tab in either tab-bearing layout; Sidebar-only still keeps one workspace per app |
| `workspaceKey` | `string` | inferred | Stable app workspace identity; normally inferred from the route |
| `title` | `string` | URL path | Tab title |
| `type` | `'route' \| 'webview'` | `'route'` | Tab type |
| `id` | `string` | Auto-generated | Custom Tab ID |

## Architecture Overview

```text
AppShell
├── Sidebar (Sidebar-only / Sidebar + Tabs)
├── TabBar (Tabs-only / Sidebar + Tabs)
├── TitleBar (Sidebar-only)
└── Content Area
    ├── TabRouter #1 (Home)
    │   └── Activity(visible) → MemoryRouter → RouterProvider
    ├── TabRouter #2 (Settings)
    │   └── Activity(hidden) → MemoryRouter → RouterProvider
    └── WebviewContainer (for webview tabs)
```

- Each Tab has its own independent `MemoryRouter` instance
- Uses React 19 `<Activity>` component to control visibility
- Components are not unmounted on Tab switch, state is fully preserved (KeepAlive)

## Error Handling

| Layer | Mechanism | Scope |
|---|---|---|
| Route render error | `defaultErrorComponent: RouteErrorFallback` on every per-tab router (`TabRouter.tsx`) | Contained to the throwing tab; themed error card with retry/reload |
| Provider render error | Window-level `<ErrorBoundary fallbackComponent={WindowFatalFallback}>` in each window App | Whole window falls back to a context-free fatal page instead of a white screen |

- A specific route can override the default with its own `errorComponent` route option
- Without `defaultErrorComponent`, TanStack wraps matches in a pass-through fragment: a route render error would bubble to the window-level boundary and tear down the whole window

## File Structure

```text
src/renderer/
├── routes/                    # Route pages (TanStack Router file-based routing)
│   ├── __root.tsx            # Root route (renders Outlet)
│   ├── settings.tsx          # /settings
│   ├── settings.index.tsx    # /settings/ index route (flat dot form — never a bare index.tsx)
│   └── README.md             # This document
├── components/layout/
│   ├── AppShell.tsx          # Main layout (Sidebar + TabBar + Content)
│   └── TabRouter.tsx         # Tab router container (MemoryRouter + Activity)
├── hooks/
│   └── useTabs.ts            # Tab state management hook
└── routeTree.gen.ts          # Auto-generated route tree (do not edit manually)
```

## Important Notes

1. **Do not manually edit `routeTree.gen.ts`** - It is automatically generated by TanStack Router
2. **File name determines route path** - `routes/settings.tsx` → `/settings`
3. **Dynamic parameters use `$`** - `routes/chat/$topicId.tsx` → `/chat/:topicId`
4. **Page state is automatically preserved** - Tab switching won't lose `useState`, scroll position, etc.

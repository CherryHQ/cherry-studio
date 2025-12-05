# Routing System Developer Guide

This project uses **TanStack Router + Multi MemoryRouter** architecture, where each Tab has its own independent router instance, enabling native KeepAlive behavior.

## Quick Start

### 1. Adding a New Page

Create a file in the `src/renderer/src/routes/` directory:

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

This project provides two navigation methods:

### 1. Tab-Level Navigation - `openTab`

Open a new Tab or switch to an existing Tab using the `useTabs` hook:

```typescript
import { useTabs } from '@renderer/hooks/useTabs'

function MyComponent() {
  const { openTab, closeTab } = useTabs()

  // Basic usage - reuse existing Tab or create new one
  openTab('/settings')

  // With title
  openTab('/chat/123', { title: 'Chat with Alice' })

  // Force new Tab (even if same URL exists)
  openTab('/settings', { forceNew: true })

  // Open Webview Tab
  openTab('https://example.com', {
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
| Open new feature module | `openTab('/knowledge')` | Creates new Tab |
| Switch sub-page in settings | `navigate({ to: '/settings/provider' })` | Navigates within current Tab |
| Open detail from list | `openTab('/chat/123', { title: '...' })` | Creates new Tab |
| Go back to previous page | `navigate({ to: '..' })` | Goes back within current Tab |

### API Reference

#### `useTabs()` Return Value

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `tabs` | `Tab[]` | List of all Tabs |
| `activeTabId` | `string` | Currently active Tab ID |
| `activeTab` | `Tab \| undefined` | Currently active Tab object |
| `openTab(url, options?)` | `(url: string, options?: OpenTabOptions) => string` | Open Tab, returns Tab ID |
| `closeTab(id)` | `(id: string) => void` | Close specified Tab |
| `setActiveTab(id)` | `(id: string) => void` | Switch to specified Tab |
| `updateTab(id, updates)` | `(id: string, updates: Partial<Tab>) => void` | Update Tab properties |

#### `OpenTabOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `forceNew` | `boolean` | `false` | Force create new Tab |
| `title` | `string` | URL path | Tab title |
| `type` | `'route' \| 'webview'` | `'route'` | Tab type |
| `id` | `string` | Auto-generated | Custom Tab ID |

## Architecture Overview

```text
AppShell
├── Sidebar
├── TabBar
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

## File Structure

```text
src/renderer/src/
├── routes/                    # Route pages (TanStack Router file-based routing)
│   ├── __root.tsx            # Root route (renders Outlet)
│   ├── index.tsx             # / Home page
│   ├── settings.tsx          # /settings
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

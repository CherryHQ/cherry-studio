# Router Planning

> Version: v0.1.0
> Updated: 2025-11-25
> Status: Draft

## 1. Overview

This document defines the routing structure plan for migrating Cherry Studio from React Router to TanStack Router (TSR).

### 1.1 Core Interaction Model

```
┌─────────────────────────────────────────────────────────────────┐
│  Left Sidebar        │  Top Tab Bar                             │
│  (Shortcuts)         │  [Tab1] [Tab2] [Tab3] [+]                │
│ ┌───────────┐        ├──────────────────────────────────────────┤
│ │ 💬 Chat   │        │                                          │
│ │ ⚙️ Settings│        │           Content Area (Outlet)          │
│ │ 📁 Files  │        │                                          │
│ │ 📝 Notes  │        │    Rendered based on active Tab's URL    │
│ │ ...       │        │                                          │
│ └───────────┘        │                                          │
└─────────────────────────────────────────────────────────────────┘
```

- **Left Sidebar**: Like a "bookmarks bar", stores shortcuts. Clicking navigates to the URL (may reuse existing Tab or create new Tab)
- **Top Tab Bar**: Manages multiple open pages, supports closing and switching
- **Content Area**: Rendered by TanStack Router's `<Outlet />`

---

## 2. Route Structure

### 2.1 Directory Structure

```
src/renderer/src/routes/
├── __root.tsx                    # Root route → AppShell
├── index.tsx                     # / → Welcome page or redirect (TBD)
│
├── chat/
│   ├── route.tsx                 # /chat layout: sidebar + <Outlet/>
│   ├── index.tsx                 # /chat → Empty state (no topic selected)
│   └── $assistantId/
│       ├── route.tsx             # /chat/$assistantId layout (optional)
│       ├── index.tsx             # /chat/$assistantId → Assistant home (optional)
│       └── $topicId.tsx          # /chat/$assistantId/$topicId → Chat view
│
├── settings/
│   ├── route.tsx                 # /settings layout: menu + <Outlet/>
│   ├── index.tsx                 # /settings → Redirect to default sub-page
│   ├── provider.tsx              # /settings/provider
│   ├── model.tsx                 # /settings/model
│   ├── general.tsx               # /settings/general
│   ├── display.tsx               # /settings/display
│   ├── data.tsx                  # /settings/data
│   ├── mcp.tsx                   # /settings/mcp
│   ├── shortcut.tsx              # /settings/shortcut
│   └── about.tsx                 # /settings/about
│
├── knowledge/
│   ├── route.tsx                 # /knowledge layout
│   ├── index.tsx                 # /knowledge → Knowledge base list
│   └── $baseId.tsx               # /knowledge/$baseId → Knowledge base detail
│
├── notes/
│   ├── route.tsx                 # /notes layout: tree sidebar + <Outlet/>
│   ├── index.tsx                 # /notes → Empty state
│   └── $noteId.tsx               # /notes/$noteId → Editor
│
├── apps/
│   ├── route.tsx                 # /apps layout
│   ├── index.tsx                 # /apps → App list
│   └── $appId.tsx                # /apps/$appId → App detail (possibly Webview)
│
├── paintings/
│   ├── route.tsx                 # /paintings layout: provider select + <Outlet/>
│   ├── index.tsx                 # /paintings → Redirect to default provider
│   ├── zhipu.tsx                 # /paintings/zhipu → Zhipu painting
│   ├── aihubmix.tsx              # /paintings/aihubmix → Aihubmix
│   ├── silicon.tsx               # /paintings/silicon → Silicon Flow
│   ├── dmxapi.tsx                # /paintings/dmxapi → Dmxapi
│   ├── tokenflux.tsx             # /paintings/tokenflux → TokenFlux
│   ├── ovms.tsx                  # /paintings/ovms → OVMS
│   └── $providerId.tsx           # /paintings/$providerId → Dynamic NewApi provider
│
├── files.tsx                     # /files → File management
├── translate.tsx                 # /translate → Translation
├── store.tsx                     # /store → App store
└── launchpad.tsx                 # /launchpad → Launchpad
```

### 2.2 Route Table

| Route | Component | Loader Data | Description |
|-------|-----------|-------------|-------------|
| `/` | `WelcomePage` | - | Welcome page or redirect (TBD) |
| `/chat` | `ChatLayout` | Assistants, Topics | Chat layout layer |
| `/chat/$assistantId/$topicId` | `ChatView` | Topic detail, Messages | Chat main view |
| `/settings` | `SettingsLayout` | - | Settings layout layer |
| `/settings/provider` | `ProviderSettings` | Provider list | Provider settings |
| `/settings/model` | `ModelSettings` | Model list | Model settings |
| `/settings/*` | `*Settings` | Respective data | Other settings pages |
| `/knowledge` | `KnowledgeLayout` | Knowledge bases | Knowledge layout |
| `/knowledge/$baseId` | `KnowledgeDetail` | Knowledge detail | Knowledge detail page |
| `/notes` | `NotesLayout` | Notes tree | Notes layout |
| `/notes/$noteId` | `NotesEditor` | Note content | Notes editor |
| `/apps` | `AppsLayout` | App list | Apps layout |
| `/apps/$appId` | `AppDetail` | App detail | App detail/Webview |
| `/paintings` | `PaintingsLayout` | Provider list | Paintings layout layer |
| `/paintings/zhipu` | `ZhipuPage` | - | Zhipu painting |
| `/paintings/aihubmix` | `AihubmixPage` | - | Aihubmix painting |
| `/paintings/silicon` | `SiliconPage` | - | Silicon Flow painting |
| `/paintings/dmxapi` | `DmxapiPage` | - | Dmxapi painting |
| `/paintings/tokenflux` | `TokenFluxPage` | - | TokenFlux painting |
| `/paintings/ovms` | `OvmsPage` | - | OVMS painting |
| `/paintings/$providerId` | `NewApiPage` | - | Dynamic NewApi provider |
| `/files` | `FilesPage` | File list | File management |
| `/translate` | `TranslatePage` | - | Translation page |
| `/store` | `StorePage` | Store data | App store |
| `/launchpad` | `LaunchpadPage` | - | Launchpad |

---

## 3. Chat Route Design

### 3.1 URL Structure

```
/chat/$assistantId/$topicId
      │             │
      │             └── Topic ID (conversation ID)
      └── Assistant ID
```

**Examples**:

- `/chat` → Chat home (sidebar + empty state)
- `/chat/assistant-1` → Assistant 1's home (optional, may redirect to first topic)
- `/chat/assistant-1/topic-123` → Chat view for topic 123 under assistant 1

### 3.2 Component Structure

```tsx
// routes/chat/route.tsx
export const Route = createFileRoute('/chat')({
  component: ChatLayout,
  loader: async () => ({
    assistants: await fetchAssistants(),
    topics: await fetchTopics()
  }),
  staleTime: 30_000,
})

function ChatLayout() {
  const data = Route.useLoaderData()

  return (
    <div className="flex h-full">
      {/* Sidebar: Assistant list + Topic list */}
      <ChatSidebar assistants={data.assistants} topics={data.topics} />

      {/* Chat content area */}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
```

```tsx
// routes/chat/$assistantId/$topicId.tsx
export const Route = createFileRoute('/chat/$assistantId/$topicId')({
  component: ChatView,
  loader: async ({ params }) => ({
    topic: await fetchTopic(params.topicId),
    messages: await fetchMessages(params.topicId)
  }),
  staleTime: 10_000,
})

function ChatView() {
  const { topic, messages } = Route.useLoaderData()
  const { assistantId, topicId } = Route.useParams()

  return (
    <div className="flex flex-col h-full">
      <ChatNavbar topic={topic} />
      <Messages messages={messages} />
      <Inputbar topicId={topicId} assistantId={assistantId} />
    </div>
  )
}
```

### 3.3 Data Flow

```
1. User clicks topic in sidebar
   ↓
2. navigate({ to: '/chat/$assistantId/$topicId' })
   ↓
3. TSR matches route, checks loader cache
   ↓
4. Cache hit → Render directly
   Cache miss → Execute loader, fetch data
   ↓
5. ChatLayout does not re-render (parent route data cached)
   ↓
6. Only ChatView updates (child route data changed)
```

---

## 4. Settings Route Design

### 4.1 Sub-page List

| Route | Component | Existing File |
|-------|-----------|---------------|
| `/settings/provider` | `ProviderSettings` | `ProviderSettings/` |
| `/settings/model` | `ModelSettings` | `ModelSettings/` |
| `/settings/general` | `GeneralSettings` | `GeneralSettings.tsx` |
| `/settings/display` | `DisplaySettings` | `DisplaySettings.tsx` |
| `/settings/data` | `DataSettings` | `DataSettings/` |
| `/settings/mcp` | `MCPSettings` | `MCPSettings/` |
| `/settings/websearch` | `WebSearchSettings` | `WebSearchSettings/` |
| `/settings/memory` | `MemorySettings` | `MemorySettings/` |
| `/settings/shortcut` | `ShortcutSettings` | `ShortcutSettings.tsx` |
| `/settings/quickassistant` | `QuickAssistantSettings` | `QuickAssistantSettings.tsx` |
| `/settings/about` | `AboutSettings` | `AboutSettings.tsx` |

### 4.2 Layout Structure

```tsx
// routes/settings/route.tsx
function SettingsLayout() {
  return (
    <div className="flex h-full">
      {/* Left menu */}
      <SettingsMenu />

      {/* Right content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
```

---

## 5. Paintings Route Design

### 5.1 URL Structure

```
/paintings/$providerId
           │
           └── Provider ID (zhipu, aihubmix, silicon, dmxapi, tokenflux, ovms, or dynamic NewApi provider)
```

**Examples**:

- `/paintings` → Redirect to user's default painting provider
- `/paintings/zhipu` → Zhipu painting page
- `/paintings/aihubmix` → Aihubmix painting page
- `/paintings/my-custom-provider` → User's custom NewApi provider

### 5.2 Provider List

| Provider ID | Component | Description |
|-------------|-----------|-------------|
| `zhipu` | `ZhipuPage` | Zhipu AI Painting |
| `aihubmix` | `AihubmixPage` | Aihubmix Aggregation |
| `silicon` | `SiliconPage` | Silicon Flow |
| `dmxapi` | `DmxapiPage` | Dmxapi |
| `tokenflux` | `TokenFluxPage` | TokenFlux |
| `ovms` | `OvmsPage` | OVMS (Local Inference) |
| `$providerId` | `NewApiPage` | Dynamic NewApi Provider |

### 5.3 Component Structure

```tsx
// routes/paintings/route.tsx
export const Route = createFileRoute('/paintings')({
  component: PaintingsLayout,
  loader: async () => ({
    providers: await fetchPaintingProviders(),
    defaultProvider: await getDefaultPaintingProvider()
  }),
})

function PaintingsLayout() {
  const { providers } = Route.useLoaderData()

  return (
    <div className="flex flex-col h-full">
      {/* Provider selector */}
      <ProviderSelect providers={providers} />

      {/* Painting content area */}
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  )
}
```

### 5.4 Special Handling

- **OVMS Provider**: Only shown in options when local OVMS service is running
- **Dynamic Providers**: Custom providers added by users via NewApi, captured using `$providerId`

---

## 6. Component Mapping

| New Route Component | Existing Component | Migration Strategy |
|---------------------|-------------------|-------------------|
| `ChatLayout` | `HomePage.tsx` | Extract sidebar logic |
| `ChatSidebar` | `HomeTabs/index.tsx` | Rename, adjust props |
| `ChatView` | `Chat.tsx` | Keep unchanged, adjust data fetching |
| `SettingsLayout` | `SettingsPage.tsx` | Extract layout logic |
| `NotesLayout` | `NotesSidebar.tsx` | Extract as layout component |
| `NotesEditor` | `NotesEditor.tsx` | Keep unchanged |

---

## 7. Open Questions

- [ ] `/` home behavior: Redirect to `/chat` or standalone welcome page?
- [ ] Does `/chat/$assistantId` need a dedicated page? Or redirect to first topic directly?
- [ ] Left sidebar interaction: Always create new Tab on click? Or reuse existing Tab?
- [ ] Tab bar UI details: Close button position, drag-to-reorder, context menu, etc.

---

## 8. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.1.0 | 2025-11-25 | Initial version |

# Router Architecture & Tab System

## Overview

This document describes the routing and tab management architecture for Cherry Studio. The system implements a "Chrome-like" tabbed interface where every tab can be a distinct application state (Chat, Settings, MinApp/Webview).

The architecture is **Hybrid**, combining:

1. **TanStack Router (HashRouter)**: Handles URL parsing and standard React page rendering. Standard pages (Home, Settings) are re-mounted on tab switch but optimized via data caching.
2. **Webview Overlay System**: Manages persistent processes (Webviews) that live *outside* the router to ensure they are never destroyed during navigation.
3. **Bidirectional State Sync**: `AppShell` ensures the URL bar and the Tab Database (`app_state` table) are always in sync.

## Core Architecture

### 1. Hybrid Rendering

We use a "Single Router + Overlay" approach. We do **not** force `KeepAlive` for standard React pages, as it complicates the router logic significantly. Instead, we rely on TanStack Router's fast caching to make re-mounting feel instant.

* **Layer 1: Standard Router (The Outlet)**
  * Always present in the DOM.
  * Renders standard pages (Home, Settings, Native Chat).
  * **Behavior**: When switching between standard tabs (e.g., Home -> Settings), the router navigates, unmounting the old component and mounting the new one.
  * **Optimization**: Data loaders are cached, so "re-mounting" is cheap and fast.
  * **Visibility**: Hidden via `display: none` if a Webview tab is active.

* **Layer 2: Webview Overlays**
  * Rendered **outside** the Router.
  * **Behavior**: These components are *never* unmounted as long as the tab is open.
  * **Visibility**: Controlled purely by CSS (`display: block` / `none`).
  * **Purpose**: To keep heavy processes (like MinApps or external websites) alive in the background.

### 2. State Synchronization (The "Listener" Pattern)

Since we use a single Router instance, we must manually sync the "Active Tab's URL" with the "Router's URL".

* **URL -> Database (Passive Sync)**:
  * A `useEffect` hook in `AppShell` listens to `location.pathname`.
  * If the URL changes (e.g., user navigates inside a Chat tab), we update the current tab's `url` field in the SQLite database.
  * *Benefit*: Restores the exact sub-route (e.g., `/chat/session-123`) when the user comes back later.

* **Tab Switch -> Router (Active Navigation)**:
  * When the user clicks a tab, we read its stored `url` from the database.
  * We calling `navigate({ to: storedUrl })` to restore the view.

### 3. Data Management

* **Storage**: Tab data (`tabs`, `activeTabId`) is stored in SQLite (`app_state` table).
* **Sync**: `useTabs` hook uses SWR (`useQuery`) to sync frontend state with the database.
* **Optimistic Updates**: UI updates immediately, background sync handles persistence.

## Routing & Overlay Mapping

For detailed route tree definitions and component mappings, please refer to [Router Planning](./router-planning.md).

### Handling Webview Routes

The planning document mentions routes like `/apps/$appId` that may correspond to Webview applications. In our Hybrid Architecture, these are handled as follows:

1. **Router Layer**: The route `/apps/$appId` is still defined in TSR.
    * Purpose: Maintains URL semantics and supports deep linking.
    * Rendering: Renders a "shell" component or loading state.
2. **Overlay Layer**: `AppShell` detects that the current Tab type is `webview`.
    * Behavior: Hides the Router's Outlet.
    * Rendering: Displays the corresponding `<Webview />` instance in the Overlay layer.

This mechanism ensures that even Webview apps have standard URLs, providing a consistent navigation experience across the application.

## Key Components

### `AppShell` (`src/renderer/src/components/layout/AppShell.tsx`)

The coordinator that manages the two layers.

```tsx
return (
  <div className="app-shell">
    <Sidebar />
    <div className="main-content">
      <TabBar />

      {/* Layer 1: Standard Router (Hidden if Webview is active) */}
      <div style={{ display: isWebviewActive ? 'none' : 'block' }}>
        <Outlet />
      </div>

      {/* Layer 2: Webview Overlays (Only for type='webview') */}
      {tabs.map(tab => {
        if (tab.type !== 'webview') return null;
        return (
           <div style={{ display: isActive ? 'block' : 'none' }}>
             <Webview url={tab.url} />
           </div>
        )
      })}
    </div>
  </div>
)
```

## Trade-offs

| Feature | Approach | Rationale |
| :--- | :--- | :--- |
| **Standard Pages** | Re-mount on switch | Simplicity. Reactivity problems with KeepAlive are avoided. TSR caching makes it fast. |
| **Webviews** | Keep-Alive (CSS Hide) | Essential. Reloading an external app/website is bad UX. |
| **Routing** | HashRouter | Native to Electron file system. Avoids history API complexities. |
| **URL Logic** | Single Source of Truth | The address bar always reflects the *active* tab. Background tabs are just state in DB. |

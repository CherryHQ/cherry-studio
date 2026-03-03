# Frontend Specification: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Input**: spec.md (user stories), data-model.md, api-spec.md (if exists), research.md

<!--
  GENERATION CONDITION:
  Only generate this file when ANY of these are true:
  - Project Type contains: web-app, mobile-app, desktop-app, saas, pwa
  - Project structure selects Option 2 (Web application) or Option 3 (Mobile + API)
  - Primary Dependencies include a UI framework (React, Vue, Angular, SwiftUI, UIKit, Flutter, Electron, etc.)
  - Feature spec user stories describe user-facing screens/pages/views
  
  SKIP this file when:
  - Project Type is: library, cli, compiler, build-tool, script, web-service (API-only)
  - Project has no user-facing interface
  - Frontend is entirely handled by a third-party or existing app (only backend work needed)
-->

## Overview

[Brief description of the frontend: what the user sees, primary interaction model, and how it connects to the backend/data layer]

## Technology Stack

**UI Framework**: [e.g., React 19, Vue 3, SwiftUI, Flutter, or extracted from Technical Context]
**Styling**: [e.g., Tailwind CSS, CSS Modules, styled-components, Ant Design, or NEEDS CLARIFICATION]
**Component Library**: [e.g., shadcn/ui, MUI, Ant Design, custom, or none]
**State Management**: [e.g., Redux Toolkit, Zustand, Pinia, Context API, or NEEDS CLARIFICATION]
**Routing**: [e.g., React Router, Next.js App Router, Vue Router, file-based, or N/A for mobile]
**Build Tool**: [e.g., Vite, Next.js, Webpack, Expo, or extracted from research]
**Package Manager**: [e.g., pnpm, npm, yarn]

## Pages / Screens

<!--
  ACTION REQUIRED: Replace the sample pages below with actual pages derived from:
  - User stories in spec.md (each story typically maps to 1+ pages/screens)
  - User journey flows (what the user navigates through)
  
  For mobile apps, replace "Route" with "Screen" and "Path" with navigation stack info.
-->

| Page / Screen | Route / Path | User Story | Auth Required | Description |
|---------------|-------------|------------|---------------|-------------|
| [e.g., Dashboard] | `/dashboard` | US1 | Yes | [Primary user landing page] |
| [e.g., Login] | `/login` | — | No | [Authentication entry point] |
| [e.g., Item Detail] | `/items/:id` | US2 | Yes | [Single item view with actions] |
| [e.g., Settings] | `/settings` | US3 | Yes | [User preferences and config] |

## Component Hierarchy

<!--
  ACTION REQUIRED: Define the component tree for the major pages.
  Focus on feature components, not every atomic element.
  Use indentation to show nesting. Mark shared/reusable components.
-->

### Layout Components (shared)

```
AppLayout
├── Sidebar / Navigation
├── Header (with user menu, notifications)
├── MainContent (slot/children)
└── Footer (if applicable)
```

### [Page 1: e.g., Dashboard]

```
DashboardPage
├── DashboardHeader (title, date range filter)
├── StatsOverview (summary cards)
│   └── StatCard (reusable) ×N
├── [PrimaryWidget] (main data display)
│   ├── [WidgetHeader]
│   └── [WidgetContent] (table/chart/list)
└── [SecondaryWidget] (supporting data)
```

### [Page 2: e.g., Item Detail]

```
ItemDetailPage
├── ItemHeader (title, status, actions)
├── ItemContent (main body)
│   ├── [SectionA]
│   └── [SectionB]
└── ItemActions (edit, delete, share)
```

[Add more pages as needed]

## State Management

<!--
  ACTION REQUIRED: Define the key state slices / stores.
  Focus on what state exists, not implementation details.
-->

### Global State

| Store / Slice | Purpose | Key Data | Persistence |
|---------------|---------|----------|-------------|
| `auth` | Authentication state | user, token, permissions | Session/Local storage |
| `ui` | UI preferences | theme, sidebar state, locale | Local storage |
| [e.g., `items`] | [Domain data] | [list, selected, filters] | [None — fetched from API] |

### Data Fetching Strategy

**Approach**: [e.g., React Query / SWR / RTK Query / tRPC / custom hooks]
**Caching**: [e.g., stale-while-revalidate with 5min TTL, or no client cache]
**Optimistic Updates**: [Yes for mutations / No / Only for specific actions]
**Real-time**: [WebSocket / SSE / polling / none]

## Key UI Patterns

<!--
  ACTION REQUIRED: Document the interaction patterns the frontend will use.
  Only include patterns that are relevant to this feature's user stories.
  Delete any that don't apply.
-->

### Forms
- **Validation**: [Client-side with Zod/Yup + server-side, or server-only]
- **Submission**: [Optimistic / loading state / disabled submit]
- **Error Display**: [Inline per field / toast / summary at top]

### Tables / Lists
- **Pagination**: [Client-side / server-side / infinite scroll / virtual scroll]
- **Sorting**: [Client / server / columns sortable]
- **Filtering**: [Search bar / filter dropdowns / combined]
- **Selection**: [Single / multi-select / none]

### Modals / Dialogs
- **Confirmation**: [Delete actions, destructive operations]
- **Forms**: [Create/edit modals vs full-page forms]

### Notifications
- **Type**: [Toast / snackbar / alert banner / notification center]
- **Triggers**: [API success/error, real-time events, validation]

### Loading States
- **Initial load**: [Skeleton / spinner / progressive]
- **Mutations**: [Button loading / overlay / optimistic]
- **Errors**: [Error boundary / inline message / retry button]

## Responsive & Accessibility

**Breakpoints**: [e.g., sm: 640px, md: 768px, lg: 1024px, xl: 1280px or framework defaults]
**Mobile Strategy**: [Responsive web / separate mobile app / PWA / N/A]
**Accessibility Targets**: [e.g., WCAG 2.1 AA, keyboard navigation, screen reader support, or minimal]
**RTL Support**: [Yes / No / Future consideration]

## Third-Party Frontend Dependencies

<!--
  List significant frontend dependencies beyond the core framework.
  Skip trivial utilities. Focus on things that affect architecture.
-->

| Dependency | Purpose | Why Chosen |
|------------|---------|------------|
| [e.g., recharts] | Data visualization | [Lightweight, React-native] |
| [e.g., react-hook-form] | Form management | [Performance, minimal re-renders] |
| [e.g., date-fns] | Date formatting | [Tree-shakeable, no mutation] |

## Frontend-Backend Contract

<!--
  If api-spec.md exists, reference it here. If not, summarize
  how the frontend communicates with the data layer.
-->

**API Base**: [e.g., `/api/v1` proxied in dev, direct in prod]
**Auth Token Handling**: [e.g., stored in httpOnly cookie / memory / localStorage]
**Error Handling**: [How frontend interprets API error responses]
**Type Safety**: [e.g., shared types from OpenAPI codegen, tRPC inference, manual types]

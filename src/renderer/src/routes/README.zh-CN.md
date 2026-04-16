# 路由系统开发指南

本项目使用 **TanStack Router + Multi MemoryRouter** 架构，每个 Tab 拥有独立的路由实例，实现原生 KeepAlive。

## 快速开始

### 1. 添加新页面

在 `src/renderer/src/routes/` 目录下创建文件：

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

运行 `yarn dev` 后，TanStack Router 会自动更新 `routeTree.gen.ts`。

### 2. 带参数的路由

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

### 3. 嵌套路由

```text
routes/
├── settings.tsx        # /settings (布局)
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

## 导航 API

本项目有两种导航方式：

### 1. Tab 级别导航 - `openTab`

打开新 Tab 或切换到已有 Tab，使用 `useTabs` hook：

```typescript
import { useTabs } from '@renderer/hooks/useTabs'

function MyComponent() {
  const { openTab, closeTab } = useTabs()

  // 基础用法 - 复用已有 Tab 或新建
  openTab('/settings')

  // 带标题
  openTab('/chat/123', { title: 'Chat with Alice' })

  // 强制新开 Tab（即使已有相同 URL）
  openTab('/settings', { forceNew: true })

  // 打开 Webview Tab
  openTab('https://example.com', {
    type: 'webview',
    title: 'Example Site'
  })

  // 关闭 Tab
  closeTab(tabId)
}
```

### 2. Tab 内部导航 - `useNavigate`

在同一个 Tab 内跳转路由（不会新开 Tab），使用 TanStack Router 的 `useNavigate`：

```typescript
import { useNavigate } from '@tanstack/react-router'

function SettingsPage() {
  const navigate = useNavigate()

  // 在当前 Tab 内跳转到子页面
  navigate({ to: '/settings/provider' })

  // 带参数跳转
  navigate({ to: '/chat/$topicId', params: { topicId: '123' } })
}
```

### 两者区别

| 场景 | 使用 | 效果 |
|-----|------|------|
| 打开新功能模块 | `openTab('/knowledge')` | 新建 Tab |
| 设置页内切换子页 | `navigate({ to: '/settings/provider' })` | 当前 Tab 内跳转 |
| 从列表打开详情 | `openTab('/chat/123', { title: '...' })` | 新建 Tab |
| 返回上一页 | `navigate({ to: '..' })` | 当前 Tab 内返回 |

### API 参考

#### `useTabs()` 返回值

| 属性/方法 | 类型 | 说明 |
|----------|------|------|
| `tabs` | `Tab[]` | 所有 Tab 列表 |
| `activeTabId` | `string` | 当前激活的 Tab ID |
| `activeTab` | `Tab \| undefined` | 当前激活的 Tab 对象 |
| `openTab(url, options?)` | `(url: string, options?: OpenTabOptions) => string` | 打开 Tab，返回 Tab ID |
| `closeTab(id)` | `(id: string) => void` | 关闭指定 Tab |
| `setActiveTab(id)` | `(id: string) => void` | 切换到指定 Tab |
| `updateTab(id, updates)` | `(id: string, updates: Partial<Tab>) => void` | 更新 Tab 属性 |

#### `OpenTabOptions`

| 选项 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `forceNew` | `boolean` | `false` | 强制新开 Tab |
| `title` | `string` | URL 路径 | Tab 标题 |
| `type` | `'route' \| 'webview'` | `'route'` | Tab 类型 |
| `id` | `string` | 自动生成 | 自定义 Tab ID |

## 架构说明

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

- 每个 Tab 拥有独立的 `MemoryRouter` 实例
- 使用 React 19 `<Activity>` 组件控制可见性
- Tab 切换时组件不卸载，状态完全保持（KeepAlive）

## 文件结构

```text
src/renderer/src/
├── routes/                    # 路由页面（TanStack Router 文件路由）
│   ├── __root.tsx            # 根路由（渲染 Outlet）
│   ├── index.tsx             # / 首页
│   ├── settings.tsx          # /settings
│   └── README.md             # 本文档
├── components/layout/
│   ├── AppShell.tsx          # 主布局（Sidebar + TabBar + Content）
│   └── TabRouter.tsx         # Tab 路由容器（MemoryRouter + Activity）
├── hooks/
│   └── useTabs.ts            # Tab 状态管理 Hook
└── routeTree.gen.ts          # 自动生成的路由树（勿手动编辑）
```

## 注意事项

1. **不要手动编辑 `routeTree.gen.ts`** - 它由 TanStack Router 自动生成
2. **路由文件命名即路径** - `routes/settings.tsx` → `/settings`
3. **动态参数使用 `$`** - `routes/chat/$topicId.tsx` → `/chat/:topicId`
4. **页面状态自动保持** - Tab 切换不会丢失 `useState`、滚动位置等

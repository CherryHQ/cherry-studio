# 路由系统开发指南

本项目使用 **TanStack Router + Multi MemoryRouter** 架构，每个 Tab 拥有独立的路由实例，实现原生 KeepAlive。

## 快速开始

### 1. 添加新页面

在 `src/renderer/routes/` 目录下创建文件：

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

本项目提供布局感知的 Shell 导航，以及 workspace 内部导航：

主窗口支持纯 Sidebar、纯多标签，以及兼容旧行为的 Sidebar + 多标签三种布局。组合布局继续使用改动前的普通标签导航行为。从纯 Sidebar 切换到任一包含顶部标签栏的布局时，顶部只展示当前 workspace；其他 Sidebar workspace 继续保留在统一 keep-alive 池中，被选中或切回纯 Sidebar 时恢复。

### 1. Shell 导航 - `openRoute`

通过 Shell 打开应用 workspace 或专注页。`openTab` 是兼容别名，行为同样会感知当前布局。

```typescript
import { useTabs } from '@renderer/hooks/tab'

function MyComponent() {
  const { openRoute, activateWorkspace, closeTab } = useTabs()

  // 纯 Sidebar：激活应用唯一 workspace；多标签/兼容布局：复用或新建 Tab
  openRoute('/app/knowledge')

  // 显式激活稳定 workspace，不覆盖其当前内部路由
  activateWorkspace('app:assistants', '/app/chat')

  // 精简布局中的工具路由使用唯一专注页
  // 兼容组合布局仍将它们作为普通标签处理
  openRoute('/settings/general')

  // Webview 仍使用普通 Tab
  openRoute('https://example.com', {
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
| 打开功能模块 | `openRoute('/app/knowledge')` | 激活纯 Sidebar workspace 或打开 Tab |
| 打开设置 / 文件预览 | `openRoute(...)` | 精简布局打开专注页；兼容组合布局保留普通标签行为 |
| 设置页内切换子页 | `navigate({ to: '/settings/provider' })` | 当前 Tab 内跳转 |
| 应用内切换会话 | `navigate(...)` | 保留应用 workspace 和组件状态 |
| 返回上一页 | `navigate({ to: '..' })` | 当前 Tab 内返回 |

### API 参考

#### `useTabs()` 返回值

| 属性/方法 | 类型 | 说明 |
|----------|------|------|
| `tabs` | `Tab[]` | 所有已挂载 Tab 和后台 Sidebar workspace |
| `tabBarTabs` | `Tab[]` | 当前展示在顶部标签栏中的 Tab |
| `activeTabId` | `string` | 当前激活的 Tab ID |
| `activeTab` | `Tab \| undefined` | 当前激活的 Tab 对象 |
| `openRoute(url, options?)` | `(url: string, options?: OpenTabOptions) => string` | 感知布局的导航；组合布局保留旧标签行为 |
| `openTab(url, options?)` | `(url: string, options?: OpenTabOptions) => string` | `openRoute` 的兼容别名 |
| `activateWorkspace(key, route, options?)` | `(string, string, OpenTabOptions?) => string` | 激活或创建唯一稳定 workspace |
| `closeFocusedRoute()` | `() => void` | 关闭专注页并恢复来源 workspace |
| `closeTab(id)` | `(id: string) => void` | 关闭指定 Tab |
| `setActiveTab(id)` | `(id: string) => void` | 切换到指定 Tab |
| `updateTab(id, updates)` | `(id: string, updates: Partial<Tab>) => void` | 更新 Tab 属性 |

#### `OpenTabOptions`

| 选项 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `forceNew` | `boolean` | `false` | 在包含顶部标签栏的布局中强制新开应用 Tab；纯 Sidebar 仍只保留一个应用 workspace |
| `workspaceKey` | `string` | 自动推导 | 稳定的应用 workspace 标识，通常根据路由自动推导 |
| `title` | `string` | URL 路径 | Tab 标题 |
| `type` | `'route' \| 'webview'` | `'route'` | Tab 类型 |
| `id` | `string` | 自动生成 | 自定义 Tab ID |

## 架构说明

```text
AppShell
├── Sidebar（纯 Sidebar / Sidebar + 多标签）
├── TabBar（纯多标签 / Sidebar + 多标签）
├── TitleBar（纯 Sidebar）
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

## 错误处理

| 层级 | 机制 | 作用范围 |
|---|---|---|
| 路由 render 错误 | 每 tab router 的 `defaultErrorComponent: RouteErrorFallback`（`TabRouter.tsx`） | 圈禁在抛错 tab 内；带主题的错误卡片，可重试/重载 |
| Provider render 错误 | 各窗口 App 最外层 `<ErrorBoundary fallbackComponent={WindowFatalFallback}>` | 整窗回退到 context-free 致命错误页，不再白屏 |

- 单个路由可用自己的 `errorComponent` 路由选项覆盖默认
- 若无 `defaultErrorComponent`，TanStack 以透传 fragment 包裹 match：路由 render 错误会冒泡到窗口级边界，炸掉整窗

## 文件结构

```text
src/renderer/
├── routes/                    # 路由页面（TanStack Router 文件路由）
│   ├── __root.tsx            # 根路由（渲染 Outlet）
│   ├── settings.tsx          # /settings
│   ├── settings.index.tsx    # /settings/ 索引路由（平铺点记法——禁止裸 index.tsx）
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

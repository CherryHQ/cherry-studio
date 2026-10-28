import { createFileRoute } from '@tanstack/react-router'

import SettingsPage from '@renderer/pages/settings/SettingsPage'

// 布局路由：SettingsPage 作为布局组件，使用 Outlet 渲染子路由
export const Route = createFileRoute('/settings')({
  component: SettingsPage
})

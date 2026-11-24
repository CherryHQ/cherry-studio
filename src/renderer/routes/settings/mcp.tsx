import { createFileRoute } from '@tanstack/react-router'

import McpSettings from '@renderer/pages/settings/McpSettings/McpSettingsPage'

// MCP 布局路由：McpSettings 作为布局组件，使用 Outlet 渲染子路由
export const Route = createFileRoute('/settings/mcp')({
  component: McpSettings
})

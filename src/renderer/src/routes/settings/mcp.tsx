import MCPSettings from '@renderer/pages/settings/MCPSettings'
import { createFileRoute } from '@tanstack/react-router'

// MCP 布局路由：MCPSettings 作为布局组件，使用 Outlet 渲染子路由
export const Route = createFileRoute('/settings/mcp')({
  component: MCPSettings
})

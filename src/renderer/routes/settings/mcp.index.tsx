import { createFileRoute, redirect } from '@tanstack/react-router'

export function redirectToMcpServers() {
  throw redirect({ to: '/settings/mcp/servers' })
}

// /settings/mcp/ 重定向到 /settings/mcp/servers
export const Route = createFileRoute('/settings/mcp/')({
  beforeLoad: redirectToMcpServers
})

import BuiltinMcpServerList from '@renderer/pages/settings/McpSettings/BuiltinMcpServerList'
import { createFileRoute } from '@tanstack/react-router'

const BuiltinWrapper = () => (
  <div className="h-full overflow-y-auto p-5">
    <BuiltinMcpServerList />
  </div>
)

export const Route = createFileRoute('/settings/mcp/builtin')({
  component: BuiltinWrapper
})

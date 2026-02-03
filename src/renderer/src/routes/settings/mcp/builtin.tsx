import BuiltinMCPServerList from '@renderer/pages/settings/MCPSettings/BuiltinMCPServerList'
import { createFileRoute } from '@tanstack/react-router'

const BuiltinWrapper = () => (
  <div className="h-full overflow-y-auto p-5">
    <BuiltinMCPServerList />
  </div>
)

export const Route = createFileRoute('/settings/mcp/builtin')({
  component: BuiltinWrapper
})

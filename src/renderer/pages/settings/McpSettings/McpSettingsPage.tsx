import { Outlet } from '@tanstack/react-router'

export default function McpSettingsPage() {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <Outlet />
    </div>
  )
}

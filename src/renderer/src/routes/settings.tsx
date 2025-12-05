import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

export const Route = createFileRoute('/settings')({
  component: SettingsPage
})

function SettingsPage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-8">
      <Settings className="size-12 text-muted-foreground" />
      <h2 className="font-semibold text-xl">Settings</h2>
      <p className="text-muted-foreground text-sm">TODO: Migrate SettingsPage</p>
    </div>
  )
}

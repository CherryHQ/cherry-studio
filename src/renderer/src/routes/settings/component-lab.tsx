import { isDev } from '@renderer/config/constant'
import ComponentLabSettings from '@renderer/pages/settings/ComponentLabSettings'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/component-lab')({
  // Component lab is a development-only playground. The menu entry in
  // SettingsPage is already gated on `isDev`, but the route itself was
  // unconditionally registered — so bookmarks / typed URLs / navigation
  // history could reach it in production. This guard keeps the path out
  // of the shipping surface entirely.
  beforeLoad: () => {
    if (!isDev) {
      throw redirect({ to: '/settings/provider' })
    }
  },
  component: ComponentLabSettings
})

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { SkillLauncherProvider } from '@renderer/hooks/useSkillLauncher'

function SkillsLayout() {
  return (
    <SkillLauncherProvider>
      <Outlet />
    </SkillLauncherProvider>
  )
}

export const Route = createFileRoute('/settings/skills')({
  component: SkillsLayout
})

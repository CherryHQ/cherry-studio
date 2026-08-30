import { SkillLauncherProvider } from '@renderer/hooks/useSkillLauncher'
import { createFileRoute, Outlet } from '@tanstack/react-router'

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

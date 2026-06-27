import { SettingsContentColumn } from '@renderer/pages/settings'
import EnvironmentDependencies from '@renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'
import { createFileRoute } from '@tanstack/react-router'

const DependenciesWrapper = () => (
  <SettingsContentColumn className="bg-transparent">
    <EnvironmentDependencies />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/dependencies')({
  component: DependenciesWrapper
})

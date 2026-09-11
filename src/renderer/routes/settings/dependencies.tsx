import { createFileRoute } from '@tanstack/react-router'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import EnvironmentDependencies from '@renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'

const DependenciesWrapper = () => (
  <SettingsContentColumn className="bg-transparent">
    <EnvironmentDependencies />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/dependencies')({
  component: DependenciesWrapper
})

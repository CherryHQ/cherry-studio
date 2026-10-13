import { createFileRoute } from '@tanstack/react-router'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import LocalModelsSection from '@renderer/pages/settings/DependenciesSettings/LocalModelsSection'

const LocalModelsSettings = () => (
  <SettingsContentColumn className="bg-transparent">
    <LocalModelsSection />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/local-models')({
  component: LocalModelsSettings
})

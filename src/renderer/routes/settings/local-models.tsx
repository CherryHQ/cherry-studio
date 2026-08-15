import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import LocalModelsSection from '@renderer/pages/settings/DependenciesSettings/LocalModelsSection'
import { createFileRoute } from '@tanstack/react-router'

const LocalModelsSettings = () => (
  <SettingsContentColumn className="bg-transparent">
    <LocalModelsSection />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/local-models')({
  component: LocalModelsSettings
})

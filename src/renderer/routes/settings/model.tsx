import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { validateModelSettingsSearch } from '@renderer/pages/settings/ModelSettings/modelSettingsFocus'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/model')({
  component: ModelSettings,
  validateSearch: validateModelSettingsSearch
})

import { createFileRoute } from '@tanstack/react-router'

import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { validateModelSettingsSearch } from '@renderer/pages/settings/ModelSettings/modelSettingsFocus'

export const Route = createFileRoute('/settings/model')({
  component: ModelSettingsRoute,
  validateSearch: validateModelSettingsSearch
})

function ModelSettingsRoute() {
  const { focus } = Route.useSearch()
  return <ModelSettings focus={focus} />
}

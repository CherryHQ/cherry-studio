import type { WebSearchProviderId } from '@renderer/types'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'

import WebSearchProviderSetting from './components/WebSearchProviderSetting'
import { WebSearchSettingsContent } from './components/WebSearchSettingsLayout'

const WebSearchProviderSettings: FC = () => {
  const params = useParams({ strict: false }) as { providerId?: string }
  const providerId = params.providerId

  if (!providerId) {
    return null
  }

  return (
    <WebSearchSettingsContent>
      <WebSearchProviderSetting providerId={providerId as WebSearchProviderId} />
    </WebSearchSettingsContent>
  )
}

export default WebSearchProviderSettings

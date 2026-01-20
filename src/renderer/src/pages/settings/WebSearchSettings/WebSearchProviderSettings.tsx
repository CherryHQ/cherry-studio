import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'

import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchProviderSettings: FC = () => {
  const params = useParams({ strict: false }) as { providerId?: string }
  const providerId = params.providerId

  if (!providerId) {
    return null
  }

  return (
    <div className="w-full px-4 py-2">
      <WebSearchProviderSetting providerId={providerId} />
    </div>
  )
}

export default WebSearchProviderSettings

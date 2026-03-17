import { getWebSearchProviderLogo } from '@renderer/config/webSearch/logo'
import type { WebSearchProviderId } from '@renderer/types'
import { Globe } from 'lucide-react'

interface Props {
  pid?: WebSearchProviderId
  size?: number
  color?: string
}

const WebSearchProviderIcon = ({ pid, size = 18, color }: Props) => {
  const Icon = pid ? getWebSearchProviderLogo(pid) : undefined

  if (Icon) {
    return <Icon.Color className="icon" width={size} height={size} color={color} />
  }

  return <Globe className="icon" size={size} style={{ color }} />
}

export default WebSearchProviderIcon

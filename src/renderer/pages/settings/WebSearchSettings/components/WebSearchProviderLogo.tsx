import { cn } from '@renderer/utils/style'
import { getWebSearchProviderLogo } from '@renderer/utils/webSearchProviderMeta'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'

interface WebSearchProviderLogoProps {
  providerId: WebSearchProviderId
  providerName: string
  size?: number
  className?: string
}

// These provider marks are cropped edge-to-edge in their source SVGs, so they read
// larger than the padded logos in this list. Inset them to match the shared padding.
const EDGE_CROPPED_PROVIDER_IDS: ReadonlySet<WebSearchProviderId> = new Set(['jina', 'tavily', 'exa', 'exa-mcp'])

const WebSearchProviderLogo: FC<WebSearchProviderLogoProps> = ({ providerId, providerName, size = 15, className }) => {
  const logo = getWebSearchProviderLogo(providerId)

  if (logo) {
    // `fetch` reuses the CherryIn squircle plate; fill it and clip to a circle so it
    // reads round like its peers instead of a floating square tile.
    if (providerId === 'fetch') {
      return <logo.Avatar size={size} shape="circle" className={cn('[&_svg]:scale-[1.4]', className)} />
    }

    return (
      <logo.Avatar
        size={size}
        shape="rounded"
        className={cn(EDGE_CROPPED_PROVIDER_IDS.has(providerId) && '[&_svg]:scale-[0.82]', className)}
      />
    )
  }

  const initial = providerName.trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm bg-sky-500 font-bold text-white text-xs leading-none',
        className
      )}
      style={{ width: size, height: size }}>
      {initial}
    </span>
  )
}

export default WebSearchProviderLogo

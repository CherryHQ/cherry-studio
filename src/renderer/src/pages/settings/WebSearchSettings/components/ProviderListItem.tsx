import { getProviderLogo } from '@renderer/config/webSearch'
import type { WebSearchProvider } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { FC } from 'react'

import { useWebSearchSettingsNav } from './Layout/WebSearchSettingsLayout'

interface Props {
  provider: WebSearchProvider
}

const ProviderListItem: FC<Props> = ({ provider }) => {
  const { isActive, navigateTo } = useWebSearchSettingsNav()
  const logo = getProviderLogo(provider.id)
  const providerPath = `/settings/websearch/provider/${provider.id}`
  const isActivePath = isActive(providerPath)

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
        isActivePath && 'bg-ghost-hover'
      )}
      onClick={() => navigateTo(providerPath)}>
      <img src={logo} alt={provider.name} className="h-5 w-5 rounded object-contain" />
      {provider.name}
    </div>
  )
}

export default ProviderListItem

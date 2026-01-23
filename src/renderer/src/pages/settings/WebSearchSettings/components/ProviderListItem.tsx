import { getProviderLogo } from '@renderer/config/webSearch'
import type { WebSearchProvider } from '@renderer/types'
import { cn } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'

interface Props {
  provider: WebSearchProvider
}

const ProviderListItem: FC<Props> = ({ provider }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const logo = getProviderLogo(provider.id)
  const isActive = location.pathname === `/settings/websearch/provider/${provider.id}`

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
        isActive && 'bg-ghost-hover'
      )}
      onClick={() => navigate({ to: '/settings/websearch/provider/$providerId', params: { providerId: provider.id } })}>
      <img src={logo} alt={provider.name} className="h-5 w-5 rounded object-contain" />
      {provider.name}
    </div>
  )
}

export default ProviderListItem

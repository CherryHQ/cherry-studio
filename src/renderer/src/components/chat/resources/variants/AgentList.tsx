import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase } from '../ResourceList'

type AgentResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
}

export function AgentResourceList<T extends ResourceListItemBase>({ children, ...props }: AgentResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="agent">
      <Frame data-testid="resource-list-agent">{children}</Frame>
    </Provider>
  )
}

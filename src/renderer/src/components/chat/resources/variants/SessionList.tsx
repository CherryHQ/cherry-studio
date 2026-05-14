import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase } from '../ResourceList'

type SessionResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
}

export function SessionResourceList<T extends ResourceListItemBase>({
  children,
  ...props
}: SessionResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="session">
      <Frame data-testid="resource-list-session">{children}</Frame>
    </Provider>
  )
}

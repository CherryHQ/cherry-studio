import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase } from '../ResourceList'

type SessionResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
  className?: string
}

export function SessionResourceList<T extends ResourceListItemBase>({
  children,
  className,
  ...props
}: SessionResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="session">
      <Frame className={className} data-testid="resource-list-session">
        {children}
      </Frame>
    </Provider>
  )
}

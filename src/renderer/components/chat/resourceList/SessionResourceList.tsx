import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase, type ResourceListPresentation } from './base'

type SessionResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
  presentation: ResourceListPresentation
}

export function SessionResourceList<T extends ResourceListItemBase>({
  children,
  presentation,
  ...props
}: SessionResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="session">
      <Frame data-testid="resource-list-session" presentation={presentation}>
        {children}
      </Frame>
    </Provider>
  )
}

import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase } from '../ResourceList'

type HistoryResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
}

export function HistoryResourceList<T extends ResourceListItemBase>({
  children,
  ...props
}: HistoryResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="history">
      <Frame data-testid="resource-list-history">{children}</Frame>
    </Provider>
  )
}

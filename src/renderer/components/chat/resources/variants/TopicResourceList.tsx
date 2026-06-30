import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase } from '../ResourceList'

type TopicResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
  className?: string
}

export function TopicResourceList<T extends ResourceListItemBase>({
  children,
  className,
  ...props
}: TopicResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="topic">
      <Frame className={className} data-testid="resource-list-topic">
        {children}
      </Frame>
    </Provider>
  )
}

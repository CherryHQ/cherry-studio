import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase, type ResourceListPresentation } from './base'

type TopicResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
  presentation: ResourceListPresentation
}

export function TopicResourceList<T extends ResourceListItemBase>({
  children,
  presentation,
  ...props
}: TopicResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="topic">
      <Frame data-ui="chat.topic-list" data-testid="resource-list-topic" presentation={presentation}>
        {children}
      </Frame>
    </Provider>
  )
}

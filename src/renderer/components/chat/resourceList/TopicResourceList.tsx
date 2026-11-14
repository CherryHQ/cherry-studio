import type { ReactNode } from 'react'

import {
  ResourceList,
  type ResourceListItemBase,
  type ResourceListPermanentDeleteProps,
  type ResourceListPresentation
} from './base'

type TopicResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  active?: boolean
  children: ReactNode
  permanentDelete?: Pick<ResourceListPermanentDeleteProps<T>, 'isItemEligible' | 'onDelete'>
  onGroupHeaderDeletePermanently?: Parameters<typeof ResourceList.Provider<T>>[0]['onGroupHeaderDeletePermanently']
  isGroupHeaderPermanentDeleteEligible?: Parameters<
    typeof ResourceList.Provider<T>
  >[0]['isGroupHeaderPermanentDeleteEligible']
  presentation: ResourceListPresentation
}

export function TopicResourceList<T extends ResourceListItemBase>({
  active = true,
  children,
  permanentDelete,
  onGroupHeaderDeletePermanently,
  isGroupHeaderPermanentDeleteEligible,
  presentation,
  ...props
}: TopicResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider
      {...props}
      variant="topic"
      onGroupHeaderDeletePermanently={onGroupHeaderDeletePermanently}
      isGroupHeaderPermanentDeleteEligible={isGroupHeaderPermanentDeleteEligible}>
      <Frame active={active} data-ui="chat.topic-list" data-testid="resource-list-topic" presentation={presentation}>
        {permanentDelete ? (
          <ResourceList.PermanentDelete
            isItemEligible={permanentDelete.isItemEligible}
            onDelete={permanentDelete.onDelete}
          />
        ) : null}
        {children}
      </Frame>
    </Provider>
  )
}

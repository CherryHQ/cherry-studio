import type { ReactNode } from 'react'

import { ResourceList, type ResourceListGroup, type ResourceListItemBase, type ResourceListPresentation } from './base'

type SessionResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
  presentation: ResourceListPresentation
  onDeletePermanently?: (item: T) => void | Promise<void>
  isPermanentDeleteEligible?: (item: T) => boolean
  onGroupHeaderDeletePermanently?: (group: ResourceListGroup) => void | Promise<void>
  isGroupHeaderPermanentDeleteEligible?: (group: ResourceListGroup) => boolean
}

export function SessionResourceList<T extends ResourceListItemBase>({
  children,
  presentation,
  onDeletePermanently,
  isPermanentDeleteEligible,
  onGroupHeaderDeletePermanently,
  isGroupHeaderPermanentDeleteEligible,
  ...props
}: SessionResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider
      {...props}
      variant="session"
      onGroupHeaderDeletePermanently={onGroupHeaderDeletePermanently}
      isGroupHeaderPermanentDeleteEligible={isGroupHeaderPermanentDeleteEligible}>
      <Frame data-testid="resource-list-session" presentation={presentation}>
        {onDeletePermanently ? (
          <ResourceList.PermanentDelete isItemEligible={isPermanentDeleteEligible} onDelete={onDeletePermanently} />
        ) : null}
        {children}
      </Frame>
    </Provider>
  )
}

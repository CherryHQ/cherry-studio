import type { ReactNode } from 'react'

import { ResourceList, type ResourceListItemBase } from '../ResourceList'

type AssistantResourceListProps<T extends ResourceListItemBase> = Omit<
  Parameters<typeof ResourceList.Provider<T>>[0],
  'variant'
> & {
  children: ReactNode
}

export function AssistantResourceList<T extends ResourceListItemBase>({
  children,
  ...props
}: AssistantResourceListProps<T>) {
  const Provider = ResourceList.Provider<T>
  const Frame = ResourceList.Frame

  return (
    <Provider {...props} variant="assistant">
      <Frame data-testid="resource-list-assistant">{children}</Frame>
    </Provider>
  )
}

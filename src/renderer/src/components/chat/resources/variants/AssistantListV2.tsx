import { ContextMenuItem } from '@cherrystudio/ui'

import { ResourceList } from '../ResourceList'
import type { ResourceListContextValue, ResourceListItemBase } from '../ResourceListContext'
import { AssistantResourceList } from './AssistantList'
import { type AssistantListActionHandlers, createAssistantListActionRegistry } from './assistantListActions'

type AssistantListV2Item = ResourceListItemBase & {
  pinned?: boolean
  updatedAt?: string | number
}

export interface AssistantListV2Labels {
  searchPlaceholder: string
  pinnedGroup: string
  assistantsGroup: string
  recentSort: string
  nameSort: string
  select: string
  pin: string
  unpin: string
  edit: string
  delete: string
  empty?: string
}

export interface AssistantListV2Props<T extends AssistantListV2Item> {
  items: readonly T[]
  labels: AssistantListV2Labels
  selectedId?: string | null
  handlers?: AssistantListActionHandlers<T>
  canDelete?: (item: T) => boolean
  canEdit?: (item: T) => boolean
  canPin?: (item: T) => boolean
  renderItem?: (item: T, context: ResourceListContextValue<T>) => React.ReactNode
}

export function AssistantListV2<T extends AssistantListV2Item>({
  items,
  labels,
  selectedId,
  handlers = {},
  canDelete = () => true,
  canEdit = () => true,
  canPin = () => true,
  renderItem
}: AssistantListV2Props<T>) {
  const registry = createAssistantListActionRegistry<T>(handlers, labels)

  return (
    <AssistantResourceList<T>
      items={items}
      selectedId={selectedId}
      defaultSortId="recent"
      sortOptions={[
        {
          id: 'recent',
          label: labels.recentSort,
          comparator: (a, b) => getTimestamp(b.updatedAt) - getTimestamp(a.updatedAt)
        },
        {
          id: 'name',
          label: labels.nameSort,
          comparator: (a, b) => a.name.localeCompare(b.name)
        }
      ]}
      groupBy={(item) =>
        item.pinned ? { id: 'pinned', label: labels.pinnedGroup } : { id: 'assistants', label: labels.assistantsGroup }
      }
      onSelectItem={(id) => {
        const item = items.find((candidate) => candidate.id === id)
        if (item) void handlers.onSelect?.(item)
      }}>
      <div className="flex shrink-0 flex-col gap-2 px-2 pt-2 pb-1">
        <ResourceList.Search placeholder={labels.searchPlaceholder} />
        <ResourceList.FilterBar />
      </div>
      {items.length === 0 ? (
        <ResourceList.EmptyState description={labels.empty} />
      ) : (
        <ResourceList.VirtualItems<T>
          renderItem={(item, context) => {
            const row = renderItem ? (
              renderItem(item, context)
            ) : (
              <ResourceList.Item item={item}>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </ResourceList.Item>
            )

            return (
              <ResourceList.ContextMenu
                item={item}
                content={registry.resolve(createActionContext(item), 'menu').map((action) => (
                  <ContextMenuItem
                    key={action.id}
                    disabled={!action.availability.enabled}
                    variant={action.danger ? 'destructive' : 'default'}
                    onSelect={() => void registry.execute(action.id, createActionContext(item))}>
                    {action.icon}
                    <span>{action.label}</span>
                  </ContextMenuItem>
                ))}>
                {row}
              </ResourceList.ContextMenu>
            )
          }}
        />
      )}
    </AssistantResourceList>
  )

  function createActionContext(item: T) {
    return {
      item,
      pinned: item.pinned === true,
      selected: selectedId === item.id,
      canPin: canPin(item),
      canEdit: canEdit(item),
      canDelete: canDelete(item)
    }
  }
}

function getTimestamp(value: string | number | undefined) {
  if (typeof value === 'number') return value
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

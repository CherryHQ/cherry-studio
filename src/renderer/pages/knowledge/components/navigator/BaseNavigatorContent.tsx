import { Accordion, EmptyState, Scrollbar } from '@cherrystudio/ui'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { type ComponentProps, useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import BaseNavigatorGroupSection from './BaseNavigatorGroupSection'
import KnowledgeBaseRow from './KnowledgeBaseRow'
import type { BaseNavigatorContentProps, KnowledgeBaseDragData, KnowledgeGroupDropData } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const isKnowledgeBaseDragData = (data: unknown): data is KnowledgeBaseDragData =>
  typeof data === 'object' && data !== null && (data as Partial<KnowledgeBaseDragData>).type === 'knowledge-base'

const isKnowledgeGroupDropData = (data: unknown): data is KnowledgeGroupDropData =>
  typeof data === 'object' && data !== null && (data as Partial<KnowledgeGroupDropData>).type === 'knowledge-group'

class KnowledgePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown',
      handler: ({ nativeEvent: event }, { onActivation }) => {
        if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey) {
          return false
        }

        onActivation?.({ event })
        return true
      }
    }
  ] as (typeof PointerSensor)['activators']
}

interface ActiveDragPreview {
  name: string
  width?: number
}

const BaseNavigatorContent = ({
  sections,
  groups,
  groupById,
  selectedBaseId,
  getGroupLabel,
  onSelectBase,
  onMoveBase,
  onRenameBase,
  onRenameGroup,
  onCreateBaseInGroup,
  onCreateGroup,
  onDeleteGroup,
  onDeleteBase
}: BaseNavigatorContentProps) => {
  const { t } = useTranslation()
  const sensors = useSensors(
    useSensor(KnowledgePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [activeDragPreview, setActiveDragPreview] = useState<ActiveDragPreview | null>(null)

  const sectionValues = useMemo(() => sections.map(({ groupId }) => groupId ?? UNGROUPED_SECTION_VALUE), [sections])
  // Controlled rather than defaultValue (which is mount-time only) so a group
  // created while the accordion is mounted starts expanded — otherwise a base
  // moved into a freshly created group would look like it vanished. Tracking
  // what the user collapsed (instead of what is open) keeps newly appearing
  // sections open by default.
  const [collapsedValues, setCollapsedValues] = useState<readonly string[]>([])
  const openValues = useMemo(
    () => sectionValues.filter((value) => !collapsedValues.includes(value)),
    [collapsedValues, sectionValues]
  )
  const handleValueChange = useCallback(
    (nextOpenValues: string[]) => {
      setCollapsedValues(sectionValues.filter((value) => !nextOpenValues.includes(value)))
    },
    [sectionValues]
  )

  // Without any group there is nothing to head the list with — render the bases
  // flat instead of under a lone "default" section header. A base whose groupId
  // points at a deleted group still yields its own section, so that (unexpected)
  // shape keeps the accordion.
  const flatSection = groups.length === 0 && sections.length === 1 && sections[0].groupId === null ? sections[0] : null

  const dragAccessibility = useMemo(() => {
    const groupNames = sections.map(({ groupId }) => getGroupLabel(groupId))
    const getBaseName = (active: DragStartEvent['active']) => {
      const data = active.data.current
      return isKnowledgeBaseDragData(data) ? data.baseName : String(active.id)
    }
    const getTargetGroupName = (over: DragEndEvent['over']) => {
      const data = over?.data.current
      return isKnowledgeGroupDropData(data) ? getGroupLabel(data.groupId) : undefined
    }

    return {
      screenReaderInstructions: {
        draggable: t('knowledge.drag.instructions', { groups: groupNames.join(', ') })
      },
      announcements: {
        onDragStart: ({ active }) => t('knowledge.drag.picked_up', { name: getBaseName(active) }),
        onDragOver: ({ active, over }) => {
          const group = getTargetGroupName(over)
          return group ? t('knowledge.drag.over', { group, name: getBaseName(active) }) : undefined
        },
        onDragEnd: ({ active, over }) => {
          const group = getTargetGroupName(over)
          const activeData = active.data.current
          const overData = over?.data.current
          const name = getBaseName(active)

          if (
            group &&
            isKnowledgeBaseDragData(activeData) &&
            isKnowledgeGroupDropData(overData) &&
            activeData.groupId === overData.groupId
          ) {
            return t('knowledge.drag.unchanged', { group, name })
          }

          return group ? t('knowledge.drag.drop_requested', { group, name }) : t('knowledge.drag.cancelled', { name })
        },
        onDragCancel: ({ active }) => t('knowledge.drag.cancelled', { name: getBaseName(active) })
      }
    } satisfies NonNullable<ComponentProps<typeof DndContext>['accessibility']>
  }, [getGroupLabel, sections, t])

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const activeData = active.data.current
    if (!isKnowledgeBaseDragData(activeData)) return

    setActiveDragPreview({
      name: activeData.baseName,
      width: active.rect.current.initial?.width
    })
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveDragPreview(null)
  }, [])

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveDragPreview(null)
      const activeData = active.data.current
      const overData = over?.data.current

      if (!isKnowledgeBaseDragData(activeData) || !isKnowledgeGroupDropData(overData)) return
      if (activeData.groupId === overData.groupId) return

      void onMoveBase(activeData.baseId, overData.groupId)
    },
    [onMoveBase]
  )

  return (
    <DndContext
      sensors={sensors}
      accessibility={dragAccessibility}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}>
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden px-2.5 pb-3">
        {sections.length === 0 || (flatSection && flatSection.items.length === 0) ? (
          <EmptyState preset="no-knowledge" title={t('knowledge.empty')} compact className="h-full" />
        ) : flatSection ? (
          <div className="space-y-1">
            {flatSection.items.map((base) => (
              <KnowledgeBaseRow
                key={base.id}
                base={base}
                groups={groups}
                selected={base.id === selectedBaseId}
                onSelectBase={onSelectBase}
                onMoveBase={onMoveBase}
                onRenameBase={onRenameBase}
                onCreateGroup={onCreateGroup}
                onDeleteBase={onDeleteBase}
              />
            ))}
          </div>
        ) : (
          <Accordion type="multiple" value={openValues} onValueChange={handleValueChange} className="space-y-3">
            {sections.map((section) => {
              const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE
              const group = section.groupId ? groupById.get(section.groupId) : undefined

              return (
                <BaseNavigatorGroupSection
                  key={groupValue}
                  section={section}
                  group={group}
                  groupLabel={group?.name ?? getGroupLabel(section.groupId)}
                  groups={groups}
                  selectedBaseId={selectedBaseId}
                  onSelectBase={onSelectBase}
                  onMoveBase={onMoveBase}
                  onRenameBase={onRenameBase}
                  onRenameGroup={onRenameGroup}
                  onCreateBaseInGroup={onCreateBaseInGroup}
                  onCreateGroup={onCreateGroup}
                  onDeleteGroup={onDeleteGroup}
                  onDeleteBase={onDeleteBase}
                />
              )
            })}
          </Accordion>
        )}
      </Scrollbar>
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeDragPreview ? (
            <div
              className="pointer-events-none rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md"
              style={{ width: activeDragPreview.width }}>
              <div className="truncate font-medium text-foreground text-sm leading-5">{activeDragPreview.name}</div>
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  )
}

export default BaseNavigatorContent

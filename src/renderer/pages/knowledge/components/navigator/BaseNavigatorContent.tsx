import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, BlurCancelPointerSensor, EmptyState, Scrollbar } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'

import BaseNavigatorGroupSection from './BaseNavigatorGroupSection'
import SortableKnowledgeBaseRow from './SortableKnowledgeBaseRow'
import type { BaseNavigatorContentProps } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const logger = loggerService.withContext('KnowledgeBaseNavigator')

const BaseNavigatorContent = ({
  onReorderBase,
  onReorderGroup,
  isReordering = false,
  isLoading,
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
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [indicator, setIndicator] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const savingRef = useRef(false)
  const dragDisabled = !onReorderBase || !onReorderGroup || isReordering
  const sensors = useSensors(
    useSensor(BlurCancelPointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] }
    })
  )
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const draggingGroup = args.active.data.current?.type === 'group'
    const droppableContainers = args.droppableContainers.filter(
      (container) =>
        !draggingGroup || (container.data.current?.type === 'group' && container.data.current.groupId !== null)
    )
    const candidates = { ...args, droppableContainers }
    const hits = pointerWithin(candidates)
    if (!draggingGroup && hits.length > 0) {
      const baseHits = hits.filter(({ id }) => String(id).startsWith('base:'))
      if (baseHits.length) return baseHits
    }
    return hits.length ? hits : closestCenter(candidates)
  }, [])
  const getIndicator = useCallback(({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return null
    const top = active.rect.current.translated?.top ?? 0
    const height = active.rect.current.translated?.height ?? 0
    return {
      id: String(over.id),
      position: top + height / 2 < over.rect.top + over.rect.height / 2 ? ('before' as const) : ('after' as const)
    }
  }, [])

  const {
    shortcuts: sidebarShortcuts,
    setPinned: setSidebarShortcutPinned,
    remove: removeSidebarShortcut
  } = useSidebarShortcuts()
  const sidebarPinnedBaseIds = useMemo(
    () =>
      new Set(
        sidebarShortcuts.flatMap((shortcut) =>
          shortcut.target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.KNOWLEDGE_BASE
            ? [shortcut.target.locator.resourceId]
            : []
        )
      ),
    [sidebarShortcuts]
  )
  const handleToggleSidebar = useCallback(
    (base: KnowledgeBaseListItem) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.KNOWLEDGE_BASE, base.id)
      if (sidebarPinnedBaseIds.has(base.id)) removeSidebarShortcut(target)
      else setSidebarShortcutPinned(target, true, base.name)
    },
    [removeSidebarShortcut, sidebarPinnedBaseIds, setSidebarShortcutPinned]
  )

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

  const clearDrag = () => {
    setActiveLabel(null)
    setIndicator(null)
  }
  const handleDragEnd = async (event: DragEndEvent) => {
    const target = getIndicator(event)
    clearDrag()
    if (!target || savingRef.current || !onReorderBase || !onReorderGroup) return
    const active = event.active.data.current
    const over = event.over?.data.current
    if (!active || !over) return
    let persist: () => Promise<void>
    if (active.type === 'group') {
      if (!active.groupId || !over.groupId || over.type !== 'group') return
      const from = sections.findIndex((section) => section.groupId === active.groupId)
      const to = sections.findIndex((section) => section.groupId === over.groupId)
      if (from < 0 || to < 0 || from === to) return
      persist = () => onReorderGroup(active.groupId, from < to ? { after: over.groupId } : { before: over.groupId })
    } else {
      const base = active.base as KnowledgeBaseListItem
      const targetGroupId = over.groupId as string | null
      const anchor: OrderRequest =
        over.type === 'base'
          ? target.position === 'before'
            ? { before: over.base.id }
            : { after: over.base.id }
          : { position: 'last' }
      const targetSection = sections.find((section) => section.groupId === targetGroupId)
      if (!targetSection) return
      setCollapsedValues((values) => values.filter((value) => value !== (targetGroupId ?? UNGROUPED_SECTION_VALUE)))
      persist = () => onReorderBase(base.id, { groupId: targetGroupId, anchor })
    }
    savingRef.current = true
    try {
      await persist()
    } catch (error) {
      logger.error('Failed to save knowledge navigator order', { error })
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_reorder')))
    } finally {
      savingRef.current = false
    }
  }

  // Without any group there is nothing to head the list with — render the bases
  // flat instead of under a lone "default" section header. A base whose groupId
  // points at a deleted group still yields its own section, so that (unexpected)
  // shape keeps the accordion.
  const flatSection = groups.length === 0 && sections.length === 1 && sections[0].groupId === null ? sections[0] : null

  // `pt-1 pb-3` mirrors the assistant and agent rails' list padding — the top inset is
  // what separates the first row from the create action above it.
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) =>
        setActiveLabel(
          active.data.current?.type === 'base'
            ? active.data.current.base.name
            : getGroupLabel(active.data.current?.groupId ?? null)
        )
      }
      onDragMove={(event) => setIndicator(getIndicator(event))}
      onDragOver={(event) => setIndicator(getIndicator(event))}
      onDragCancel={clearDrag}
      onDragEnd={handleDragEnd}>
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden pt-1 pb-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : sections.length === 0 || (flatSection && flatSection.items.length === 0) ? (
          // KnowledgePage normally owns the zero-base empty state; keep a defensive fallback
          // for a transient empty collection while navigator data changes.
          <EmptyState preset="no-result" title={t('common.no_results')} compact className="h-full" />
        ) : flatSection ? (
          <SortableContext
            items={flatSection.items.map((base) => `base:${base.id}`)}
            strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {flatSection.items.map((base) => (
                <SortableKnowledgeBaseRow
                  key={base.id}
                  disabled={dragDisabled}
                  indicator={indicator?.id === `base:${base.id}` ? indicator.position : undefined}
                  base={base}
                  groups={groups}
                  selected={base.id === selectedBaseId}
                  onSelectBase={onSelectBase}
                  onMoveBase={onMoveBase}
                  onRenameBase={onRenameBase}
                  onCreateGroup={onCreateGroup}
                  onDeleteBase={onDeleteBase}
                  onToggleSidebar={handleToggleSidebar}
                  sidebarPinned={sidebarPinnedBaseIds.has(base.id)}
                />
              ))}
            </div>
          </SortableContext>
        ) : (
          <SortableContext
            items={sections.map((section) => `group:${section.groupId ?? UNGROUPED_SECTION_VALUE}`)}
            strategy={verticalListSortingStrategy}>
            <Accordion type="multiple" value={openValues} onValueChange={handleValueChange} className="space-y-3">
              {sections.map((section) => {
                const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE
                const group = section.groupId ? groupById.get(section.groupId) : undefined

                return (
                  <BaseNavigatorGroupSection
                    key={groupValue}
                    dragDisabled={dragDisabled}
                    indicator={indicator}
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
                    onToggleSidebar={handleToggleSidebar}
                    sidebarPinnedBaseIds={sidebarPinnedBaseIds}
                  />
                )
              })}
            </Accordion>
          </SortableContext>
        )}
      </Scrollbar>
      <DragOverlay dropAnimation={null}>
        {activeLabel ? (
          <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-sm">
            {activeLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export default BaseNavigatorContent

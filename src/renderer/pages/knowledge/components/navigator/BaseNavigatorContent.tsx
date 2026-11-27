import { type DragEndEvent, DragOverlay, type DragStartEvent } from '@dnd-kit/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, DragDropRoot, EmptyState, ScrollArea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { toast } from '@renderer/services/toast'
import { getInsertionSide } from '@renderer/utils/dragDrop'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'

import BaseNavigatorGroupSection from './BaseNavigatorGroupSection'
import { getNavigatorDragData } from './navigatorDrag'
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
  const savingRef = useRef(false)
  const dragDisabled = !onReorderBase || !onReorderGroup || isReordering
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

  const handleDragEnd = async ({ canceled, operation }: DragEndEvent) => {
    const side = getInsertionSide(operation)
    setActiveLabel(null)
    if (canceled || !side || savingRef.current || !onReorderBase || !onReorderGroup) return
    const active = getNavigatorDragData(operation.source)
    const over = getNavigatorDragData(operation.target)
    if (!active || !over) return
    let persist: () => Promise<void>
    if (active.type === 'group') {
      const activeGroupId = active.groupId
      const overGroupId = over.groupId
      if (!activeGroupId || !overGroupId || over.type !== 'group') return
      const from = sections.findIndex((section) => section.groupId === activeGroupId)
      const to = sections.findIndex((section) => section.groupId === overGroupId)
      if (from < 0 || to < 0 || from === to) return
      persist = () => onReorderGroup(activeGroupId, from < to ? { after: overGroupId } : { before: overGroupId })
    } else {
      const base = active.base
      const targetGroupId = over.groupId
      const anchor: OrderRequest =
        over.type === 'base'
          ? side === 'before'
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
    <DragDropRoot
      onDragStart={({ operation }: DragStartEvent) => {
        const active = getNavigatorDragData(operation.source)
        setActiveLabel(active?.type === 'base' ? active.base.name : getGroupLabel(active?.groupId ?? null))
      }}
      onDragEnd={handleDragEnd}>
      <ScrollArea
        contentProps={{ className: 'pt-1 pb-3' }}
        viewportProps={{ className: 'overflow-x-hidden' }}
        className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : sections.length === 0 || (flatSection && flatSection.items.length === 0) ? (
          // KnowledgePage normally owns the zero-base empty state; keep a defensive fallback
          // for a transient empty collection while navigator data changes.
          <EmptyState title={t('common.no_results')} compact className="h-full" />
        ) : flatSection ? (
          <div className="space-y-1">
            {flatSection.items.map((base, index) => (
              <SortableKnowledgeBaseRow
                key={base.id}
                index={index}
                sectionValue={UNGROUPED_SECTION_VALUE}
                disabled={dragDisabled}
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
        ) : (
          <Accordion type="multiple" value={openValues} onValueChange={handleValueChange} className="space-y-3">
            {sections.map((section, index) => {
              const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE
              const group = section.groupId ? groupById.get(section.groupId) : undefined

              return (
                <BaseNavigatorGroupSection
                  key={groupValue}
                  index={index}
                  dragDisabled={dragDisabled}
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
        )}
      </ScrollArea>
      <DragOverlay dropAnimation={null}>
        {activeLabel ? (
          <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-sm">
            {activeLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DragDropRoot>
  )
}

export default BaseNavigatorContent

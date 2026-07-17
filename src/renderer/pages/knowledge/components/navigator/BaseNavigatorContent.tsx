import { Accordion, EmptyState, Scrollbar } from '@cherrystudio/ui'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigatorGroupSection from './BaseNavigatorGroupSection'
import KnowledgeBaseRow from './KnowledgeBaseRow'
import type { BaseNavigatorContentProps } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const BaseNavigatorContent = ({
  hasBases,
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

  return (
    <Scrollbar className="min-h-0 flex-1 overflow-x-hidden px-2.5 pb-3">
      {!hasBases ? (
        // Truly empty (no bases at all — empty groups may still exist and are
        // deliberately hidden behind the state) names the list state here; the
        // content pane carries the "build knowledge with AI" invitation.
        <EmptyState preset="no-knowledge" title={t('knowledge.empty')} compact className="h-full" />
      ) : sections.length === 0 || (flatSection && flatSection.items.length === 0) ? (
        // Bases exist but nothing survived filtering — the search matched nothing.
        <EmptyState preset="no-result" title={t('common.no_results')} compact className="h-full" />
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
  )
}

export default BaseNavigatorContent

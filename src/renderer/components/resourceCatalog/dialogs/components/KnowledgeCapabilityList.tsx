import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreateKnowledgeBaseDialog from '@renderer/components/knowledge/CreateKnowledgeBaseDialog'
import { useExitPresence } from '@renderer/hooks/useExitPresence'
import { useGroups } from '@renderer/hooks/useGroups'
import { useCreateKnowledgeBase, useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'

import { type CapabilityItem, CapabilityList } from './CapabilityList'
import { KnowledgeBaseAvatar } from './EditDialogShared'

/** Knowledge bases linked to an Assistant or Agent; a base created from here is linked right away. */
export function KnowledgeCapabilityList({
  selectedIds,
  onSelectedIdsChange,
  portalContainer,
  disabled = false
}: {
  selectedIds: readonly string[]
  onSelectedIdsChange: (ids: string[]) => void
  portalContainer: HTMLElement | null
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { bases, isLoading } = useKnowledgeBases({ revalidateOnFocus: true })
  const [createOpen, setCreateOpen] = useState(false)
  const { groups } = useGroups('knowledge', { enabled: createOpen })
  const { createBase, isCreating } = useCreateKnowledgeBase()
  // Mounted only while open (and closing), as on the knowledge page.
  const createDialog = useExitPresence(createOpen ? true : null)

  const items = useMemo<CapabilityItem[]>(
    () =>
      bases.map((base) => ({
        id: base.id,
        name: base.name,
        description: t('library.config.knowledge.doc_count', { count: base.itemCount ?? 0 }),
        icon: <KnowledgeBaseAvatar />
      })),
    [bases, t]
  )

  return (
    <CapabilityList
      items={items}
      selectedIds={selectedIds}
      onSelectedIdsChange={onSelectedIdsChange}
      searchPlaceholder={t('library.config.knowledge.search')}
      addLabel={t('library.config.knowledge.add')}
      addActions={[
        { id: 'create', label: t('knowledge.add.title'), icon: <Plus />, onSelect: () => setCreateOpen(true) }
      ]}
      emptyLabel={t('library.config.knowledge.none')}
      portalContainer={portalContainer}
      loading={isLoading}
      disabled={disabled}>
      {createDialog.isPresent ? (
        <CreateKnowledgeBaseDialog
          open={createOpen}
          groups={groups}
          isCreating={isCreating}
          createBase={createBase}
          onOpenChange={setCreateOpen}
          onCreated={(base) => onSelectedIdsChange(Array.from(new Set([...selectedIds, base.id])))}
        />
      ) : null}
    </CapabilityList>
  )
}

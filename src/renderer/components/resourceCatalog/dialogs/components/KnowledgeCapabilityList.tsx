import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
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
  const [sortKey, setSortKey] = useState('linked')
  const [createOpen, setCreateOpen] = useState(false)
  const { groups } = useGroups('knowledge', { enabled: createOpen })
  const { createBase, isCreating } = useCreateKnowledgeBase()
  // Mounted only while open (and closing), as on the knowledge page.
  const createDialog = useExitPresence(createOpen ? true : null)

  const items = useMemo<CapabilityItem[]>(
    () =>
      [...bases]
        .sort((a, b) => {
          if (sortKey === 'name') return a.name.localeCompare(b.name)
          if (sortKey === 'created') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
          const left = selectedIds.indexOf(a.id),
            right = selectedIds.indexOf(b.id)
          return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right)
        })
        .map((base) => ({
          id: base.id,
          name: base.name,
          description: t('library.config.knowledge.doc_count', { count: base.itemCount ?? 0 }),
          icon: <KnowledgeBaseAvatar />
        })),
    [bases, t, sortKey, selectedIds]
  )

  return (
    <div className="flex flex-col gap-2">
      <Select value={sortKey} onValueChange={setSortKey}>
        <SelectTrigger size="sm" className="w-[140px] self-end" aria-label={t('library.config.knowledge.sort')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent portalContainer={portalContainer}>
          <SelectItem value="linked">{t('library.config.knowledge.sort_linked')}</SelectItem>
          <SelectItem value="name">{t('library.config.knowledge.sort_name')}</SelectItem>
          <SelectItem value="created">{t('library.config.knowledge.sort_created')}</SelectItem>
        </SelectContent>
      </Select>
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
    </div>
  )
}

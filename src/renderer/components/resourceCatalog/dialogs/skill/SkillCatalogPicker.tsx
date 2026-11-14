import { FolderSearch, Import, Search, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InstalledSkill } from '@shared/data/types/agent'

import { CapabilityIconTile, type CapabilityItem, CapabilityList } from '../components/CapabilityList'
import { ImportSkillDialog } from './ImportSkillDialog'
import { SkillMarketplaceDialog } from './SkillMarketplaceDialog'
import { SystemSkillDialog } from './SystemSkillDialog'

type SkillCatalogPickerProps = {
  mode: 'create' | 'edit'
  skills: InstalledSkill[]
  loading: boolean
  selectedIds: readonly string[]
  onSelectedIdsChange: (ids: string[]) => void
  emptyLabel: ReactNode
  portalContainer: HTMLElement | null
  disabled?: boolean
}

const skillIcon = (
  <CapabilityIconTile>
    <Zap size={13} strokeWidth={1.6} />
  </CapabilityIconTile>
)

/**
 * Skill list for Agent forms. In create mode builtin skills are shown locked on and never
 * written to the selection (the server always enables them), and the selection only keeps
 * skills that are still available.
 */
export function SkillCatalogPicker({
  mode,
  skills,
  loading,
  selectedIds,
  onSelectedIdsChange,
  emptyLabel,
  portalContainer,
  disabled = false
}: SkillCatalogPickerProps) {
  const { t } = useTranslation()
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [systemSkillOpen, setSystemSkillOpen] = useState(false)
  const availableSkills = useMemo(() => skills.filter((skill) => skill.isGlobalEnabled), [skills])

  const items = useMemo<CapabilityItem[]>(
    () =>
      availableSkills.map((skill) => {
        const locked = mode === 'create' && skill.source === 'builtin'
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          icon: skillIcon,
          locked,
          badge: locked ? t('library.config.dialogs.create.capability.builtin_badge') : undefined
        }
      }),
    [availableSkills, mode, t]
  )
  const changeSelection = (ids: string[]) => {
    if (mode === 'edit') return onSelectedIdsChange(ids)
    const selectable = new Set(items.filter((item) => !item.locked).map((item) => item.id))
    onSelectedIdsChange(ids.filter((id) => selectable.has(id)))
  }

  return (
    <CapabilityList
      items={items}
      selectedIds={selectedIds}
      onSelectedIdsChange={changeSelection}
      searchPlaceholder={t('library.config.dialogs.create.capability.search')}
      addLabel={t('library.skill_add.add')}
      addActions={[
        {
          id: 'online',
          label: t('library.skill_add.online_search'),
          icon: <Search />,
          onSelect: () => setMarketplaceOpen(true)
        },
        {
          id: 'import',
          label: t('library.skill_add.local_import'),
          icon: <Import />,
          onSelect: () => setImportOpen(true)
        },
        {
          id: 'system',
          label: t('library.skill_add.system_search'),
          icon: <FolderSearch />,
          onSelect: () => setSystemSkillOpen(true)
        }
      ]}
      emptyLabel={emptyLabel}
      portalContainer={portalContainer}
      loading={loading}
      disabled={disabled}>
      <SkillMarketplaceDialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen} />
      <ImportSkillDialog open={importOpen} onOpenChange={setImportOpen} />
      <SystemSkillDialog
        mode="agent-create"
        open={systemSkillOpen}
        onOpenChange={setSystemSkillOpen}
        selectedSkillIds={selectedIds}
        onEnabled={(skillId) => onSelectedIdsChange(Array.from(new Set([...selectedIds, skillId])))}
      />
    </CapabilityList>
  )
}

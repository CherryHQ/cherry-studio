import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch
} from '@cherrystudio/ui'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import type { InstalledSkill } from '@shared/data/types/agent'
import { ChevronDown, Download, FolderSearch, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type CatalogItem, CatalogToggleGrid } from '../components/CatalogPicker'
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
  onRemoveSkill?: (skillId: string) => Promise<boolean | void>
  disabled?: boolean
}

/** Shared Skill search, bulk-selection, and installation surface for Agent forms. */
export function SkillCatalogPicker({
  mode,
  skills,
  loading,
  selectedIds,
  onSelectedIdsChange,
  emptyLabel,
  portalContainer,
  onRemoveSkill,
  disabled = false
}: SkillCatalogPickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [systemSkillOpen, setSystemSkillOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<InstalledSkill | null>(null)
  const [removing, setRemoving] = useState(false)

  const builtinIds = useMemo(
    () => (mode === 'create' ? skills.filter((skill) => skill.source === 'builtin').map((skill) => skill.id) : []),
    [mode, skills]
  )
  const selectableIds = useMemo(
    () => skills.filter((skill) => mode === 'edit' || skill.source !== 'builtin').map((skill) => skill.id),
    [mode, skills]
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const enabledIds = useMemo(() => new Set([...selectedIds, ...builtinIds]), [builtinIds, selectedIds])
  const catalog = useMemo<CatalogItem[]>(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return skills
      .filter((skill) => !normalizedQuery || skill.name.toLowerCase().includes(normalizedQuery))
      .map((skill) => {
        if (mode === 'create' && skill.source === 'builtin') {
          return {
            id: skill.id,
            name: skill.name,
            disableToggle: true,
            inactiveBadge: t('library.config.dialogs.create.capability.builtin_badge')
          }
        }

        const canRemove = mode === 'create' && ['marketplace', 'system'].includes(skill.source) && onRemoveSkill

        return {
          id: skill.id,
          name: skill.name,
          description: mode === 'edit' ? skill.description : undefined,
          icon: mode === 'edit' ? <Sparkles size={13} strokeWidth={1.5} className="text-amber-500/60" /> : undefined,
          action: canRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('library.action.uninstall')}
              disabled={disabled || removing}
              onClick={() => setRemoveTarget(skill)}
              className="shrink-0 text-foreground-muted hover:text-destructive">
              <Trash2 size={14} />
            </Button>
          ) : undefined
        }
      })
  }, [disabled, mode, onRemoveSkill, query, removing, skills, t])
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIdSet.has(id))

  const setSelected = (id: string, enabled: boolean) => {
    onSelectedIdsChange(
      enabled ? Array.from(new Set([...selectedIds, id])) : selectedIds.filter((selectedId) => selectedId !== id)
    )
  }

  const handleRemoveSkill = async () => {
    if (!removeTarget || !onRemoveSkill) return

    setRemoving(true)
    try {
      const removed = await onRemoveSkill(removeTarget.id)
      if (removed === false) return
      onSelectedIdsChange(selectedIds.filter((selectedId) => selectedId !== removeTarget.id))
      setRemoveTarget(null)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className={mode === 'create' ? 'flex flex-col gap-3' : 'grid gap-4'}>
      <div className="flex items-center gap-2">
        <ResourceCatalogSearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('library.config.dialogs.create.capability.search')}
          className="min-w-0 flex-1"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="shrink-0" disabled={disabled}>
              <Plus size={13} />
              {t('library.skill_add.add')}
              <ChevronDown size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44" portalContainer={portalContainer}>
            <DropdownMenuItem onSelect={() => setMarketplaceOpen(true)}>
              <Search />
              {t('library.skill_add.online_search')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <Download />
              {t('library.skill_add.local_import')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSystemSkillOpen(true)}>
              <FolderSearch />
              {t('library.skill_add.system_search')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground text-sm">
          {t('library.config.agent.section.tools.skills_enable_all')}
        </span>
        <Switch
          size="sm"
          checked={allSelected}
          disabled={loading || disabled || selectableIds.length === 0}
          onCheckedChange={(selected) => onSelectedIdsChange(selected ? selectableIds : [])}
          aria-label={t('library.config.agent.section.tools.skills_enable_all')}
        />
      </div>

      <CatalogToggleGrid
        items={catalog}
        enabledIds={enabledIds}
        loading={loading}
        disabled={disabled}
        onToggle={setSelected}
        emptyLabel={emptyLabel}
        portalContainer={portalContainer}
        variant={mode === 'create' ? 'checkbox' : 'switch'}
      />

      <SkillMarketplaceDialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen} />
      <ImportSkillDialog open={importOpen} onOpenChange={setImportOpen} />
      <SystemSkillDialog
        mode="agent-create"
        open={systemSkillOpen}
        onOpenChange={setSystemSkillOpen}
        selectedSkillIds={selectedIds}
        onEnabled={(skillId) => onSelectedIdsChange(Array.from(new Set([...selectedIds, skillId])))}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(null)
        }}
        title={t('library.delete.skill.title')}
        description={t('library.delete.skill.content')}
        confirmText={t('library.action.uninstall')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={removing}
        onConfirm={handleRemoveSkill}
      />
    </div>
  )
}

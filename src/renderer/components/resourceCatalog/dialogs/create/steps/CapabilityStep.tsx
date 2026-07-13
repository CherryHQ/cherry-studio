import { Button, Input, Switch } from '@cherrystudio/ui'
import {
  type CatalogItem,
  CatalogToggleGrid
} from '@renderer/components/resourceCatalog/dialogs/components/CatalogPicker'
import { ImportSkillDialog, SkillMarketplaceDialog } from '@renderer/components/resourceCatalog/dialogs/import'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { Download, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

type CapabilityStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/**
 * Step 3 (agent): pick the skills this agent can use. The global skill library
 * supports local filtering, online registry search, and local import. Selections
 * are stored as `skillIds`; the wizard stays mounted while installing, so form
 * data is preserved and the list refreshes once a skill lands.
 *
 * Builtin skills are shown pre-checked and locked (not part of `skillIds`)
 * since the server always enables them for new agents regardless of what's
 * submitted here — this keeps the picker truthful about what will exist after
 * creation instead of showing a togglable state that submit would ignore.
 */
export function CapabilityStep({ form, portalContainer }: CapabilityStepProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const skillIds = form.watch('skillIds')
  const { skills, loading, refresh } = useInstalledSkills()
  const builtinSkillIds = useMemo(
    () => skills.filter((skill) => skill.source === 'builtin').map((skill) => skill.id),
    [skills]
  )
  const selectableSkillIds = useMemo(
    () => skills.filter((skill) => skill.source !== 'builtin').map((skill) => skill.id),
    [skills]
  )
  const skillCatalog = useMemo<CatalogItem[]>(() => {
    const q = query.trim().toLowerCase()
    return skills
      .filter((skill) => !q || skill.name.toLowerCase().includes(q))
      .map((skill) =>
        skill.source === 'builtin'
          ? {
              id: skill.id,
              name: skill.name,
              disableToggle: true,
              inactiveBadge: t('library.config.dialogs.create.capability.builtin_badge')
            }
          : { id: skill.id, name: skill.name }
      )
  }, [skills, query, t])
  const enabledSkillIds = useMemo(() => new Set([...skillIds, ...builtinSkillIds]), [skillIds, builtinSkillIds])
  const allSkillsSelected =
    selectableSkillIds.length > 0 && selectableSkillIds.every((skillId) => enabledSkillIds.has(skillId))
  const toggleSkill = (id: string, enabled: boolean) =>
    form.setValue('skillIds', enabled ? [...skillIds, id] : skillIds.filter((s) => s !== id), { shouldDirty: true })
  const toggleAllSkills = (selected: boolean) =>
    form.setValue('skillIds', selected ? selectableSkillIds : [], { shouldDirty: true })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('library.config.dialogs.create.capability.search')}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={() => setMarketplaceOpen(true)}>
          <Search size={13} />
          {t('library.skill_add.online_search')}
        </Button>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setImportOpen(true)}>
          <Download size={13} />
          {t('library.config.dialogs.create.capability.import')}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground text-sm">
          {t('library.config.agent.section.tools.skills_enable_all')}
        </span>
        <Switch
          size="sm"
          checked={allSkillsSelected}
          disabled={loading || selectableSkillIds.length === 0}
          onCheckedChange={toggleAllSkills}
          aria-label={t('library.config.agent.section.tools.skills_enable_all')}
        />
      </div>

      <CatalogToggleGrid
        items={skillCatalog}
        enabledIds={enabledSkillIds}
        loading={loading}
        onToggle={toggleSkill}
        emptyLabel={t('library.config.dialogs.create.capability.no_skills')}
        portalContainer={portalContainer}
        variant="checkbox"
      />

      <SkillMarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        onInstalled={() => void refresh()}
      />
      <ImportSkillDialog open={importOpen} onOpenChange={setImportOpen} onInstalled={() => void refresh()} />
    </div>
  )
}

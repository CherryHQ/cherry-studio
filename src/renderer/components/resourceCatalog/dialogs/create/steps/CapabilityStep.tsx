import { Button, Input } from '@cherrystudio/ui'
import {
  type CatalogItem,
  CatalogToggleGrid
} from '@renderer/components/resourceCatalog/dialogs/components/CatalogPicker'
import { ImportSkillDialog } from '@renderer/components/resourceCatalog/dialogs/import'
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
 * Step 3 (agent): pick the skills this agent can use. Global skill library with
 * a search box and an "import from library" action that opens the shared
 * ImportSkillDialog. Selections are stored as the create-only `skillIds`; the
 * wizard stays mounted while importing, so form data is preserved and the list
 * refreshes (via `/skills` cache invalidation) once a skill lands.
 */
export function CapabilityStep({ form, portalContainer }: CapabilityStepProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const skillIds = form.watch('skillIds')
  const { skills, loading, refresh } = useInstalledSkills()
  const skillCatalog = useMemo<CatalogItem[]>(() => {
    const q = query.trim().toLowerCase()
    return skills
      .filter((skill) => !q || skill.name.toLowerCase().includes(q))
      .map((skill) => ({ id: skill.id, name: skill.name }))
  }, [skills, query])
  const enabledSkillIds = useMemo(() => new Set(skillIds), [skillIds])
  const toggleSkill = (id: string, enabled: boolean) =>
    form.setValue('skillIds', enabled ? [...skillIds, id] : skillIds.filter((s) => s !== id), { shouldDirty: true })

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
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setImportOpen(true)}>
          <Download size={13} />
          {t('library.config.dialogs.create.capability.import')}
        </Button>
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

      <ImportSkillDialog open={importOpen} onOpenChange={setImportOpen} onInstalled={() => void refresh()} />
    </div>
  )
}

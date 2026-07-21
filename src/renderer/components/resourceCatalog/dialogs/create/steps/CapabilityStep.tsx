import { SkillCatalogPicker } from '@renderer/components/resourceCatalog/dialogs/skill'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
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
 * data is preserved while the shared `/skills` cache updates.
 *
 * Builtin skills are shown pre-checked and locked (not part of `skillIds`)
 * since the server always enables them for new agents regardless of what's
 * submitted here — this keeps the picker truthful about what will exist after
 * creation instead of showing a togglable state that submit would ignore.
 */
export function CapabilityStep({ form, portalContainer }: CapabilityStepProps) {
  const { t } = useTranslation()
  const skillIds = form.watch('skillIds')
  const { skills, loading, uninstall } = useInstalledSkills()

  return (
    <SkillCatalogPicker
      mode="create"
      skills={skills}
      loading={loading}
      selectedIds={skillIds}
      onSelectedIdsChange={(ids) => form.setValue('skillIds', ids, { shouldDirty: true })}
      emptyLabel={t('library.config.dialogs.create.capability.no_skills')}
      portalContainer={portalContainer}
      onRemoveSkill={uninstall}
    />
  )
}

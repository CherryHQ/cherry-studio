import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { SkillCatalogPicker } from '@renderer/components/resourceCatalog/dialogs/skill'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'

import { getCreateSkillIds, isActiveCreateSkill } from '../getCreateSkillIds'
import type { ResourceCreateWizardFormValues } from '../types'

type CapabilityStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

export function CapabilityStep({ form, portalContainer }: CapabilityStepProps) {
  const { t } = useTranslation()
  const [skillIds, disabledSkillIds] = useWatch({ control: form.control, name: ['skillIds', 'disabledSkillIds'] })
  useReconcileSkillsOnOpen(true)
  const { skills, loading } = useInstalledSkills()
  const activeSkills = skills.filter(isActiveCreateSkill)
  const selectedIds = getCreateSkillIds(skills, skillIds, disabledSkillIds)

  const changeSelection = (ids: string[]) => {
    if (skillIds !== undefined) {
      form.setValue('skillIds', ids, { shouldDirty: true })
      return
    }
    const selected = new Set(ids)
    const disabled = new Set([...(disabledSkillIds ?? []), ...getCreateSkillIds(skills)])
    form.setValue(
      'disabledSkillIds',
      [...disabled].filter((id) => !selected.has(id)),
      { shouldDirty: true }
    )
  }

  return (
    <>
      {activeSkills.length < skills.length ? (
        <div className="mb-3 text-muted-foreground text-xs">
          <p className="font-medium text-foreground">{t('settings.skills.pendingActivation')}</p>
          <p>{t('settings.skills.pendingActivationDescription')}</p>
        </div>
      ) : null}
      <SkillCatalogPicker
        mode="create"
        skills={activeSkills}
        loading={loading}
        selectedIds={selectedIds}
        onSelectedIdsChange={changeSelection}
        emptyLabel={t('library.config.dialogs.create.capability.no_skills')}
        portalContainer={portalContainer}
      />
    </>
  )
}

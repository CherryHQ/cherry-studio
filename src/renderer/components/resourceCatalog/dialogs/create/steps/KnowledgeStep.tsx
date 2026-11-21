import { type UseFormReturn, useWatch } from 'react-hook-form'

import { KnowledgeCapabilityList } from '@renderer/components/resourceCatalog/dialogs/components/KnowledgeCapabilityList'

import type { ResourceCreateWizardFormValues } from '../types'

type KnowledgeStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  isSubmitting?: boolean
  portalContainer: HTMLElement | null
}

/** Attach knowledge bases, bound to `knowledgeBaseIds`. */
export function KnowledgeStep({ form, isSubmitting = false, portalContainer }: KnowledgeStepProps) {
  const knowledgeBaseIds = useWatch({ control: form.control, name: 'knowledgeBaseIds' })

  return (
    <KnowledgeCapabilityList
      selectedIds={knowledgeBaseIds}
      onSelectedIdsChange={(ids) => form.setValue('knowledgeBaseIds', ids, { shouldDirty: true })}
      portalContainer={portalContainer}
      disabled={isSubmitting}
    />
  )
}

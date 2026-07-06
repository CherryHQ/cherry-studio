import { KnowledgeBaseField } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import type { UseFormReturn } from 'react-hook-form'

import type { ResourceCreateWizardFormValues } from '../types'

type KnowledgeStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/**
 * Step 3 (assistant): attach knowledge bases. Mirrors the edit dialog's
 * knowledge sub-form — picker popover + linked list — bound to `knowledgeBaseIds`.
 */
export function KnowledgeStep({ form, portalContainer }: KnowledgeStepProps) {
  return <KnowledgeBaseField form={form} portalContainer={portalContainer} formLabel={false} />
}

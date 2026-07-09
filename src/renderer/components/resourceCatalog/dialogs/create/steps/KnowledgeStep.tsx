import { KnowledgeBaseField } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { useTabs } from '@renderer/hooks/tab'
import { useCallback } from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { ResourceCreateWizardFormValues } from '../types'

type KnowledgeStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  onClose?: () => void
  portalContainer: HTMLElement | null
}

/**
 * Step 3 (assistant): attach knowledge bases. Mirrors the edit dialog's
 * knowledge sub-form — picker popover + linked list — bound to `knowledgeBaseIds`.
 */
export function KnowledgeStep({ form, onClose, portalContainer }: KnowledgeStepProps) {
  const { openTab } = useTabs()
  const openKnowledgePage = useCallback(() => {
    onClose?.()
    openTab('/app/knowledge')
  }, [onClose, openTab])

  return (
    <KnowledgeBaseField
      form={form}
      portalContainer={portalContainer}
      formLabel={false}
      onOpenKnowledgePage={openKnowledgePage}
    />
  )
}

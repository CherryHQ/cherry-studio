import { KnowledgeBaseField } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { ipcApi } from '@renderer/ipc'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { uuid } from '@renderer/utils/uuid'
import { useCallback } from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { ResourceCreateWizardFormValues } from '../types'

type KnowledgeStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  isSubmitting?: boolean
  portalContainer: HTMLElement | null
}

/**
 * Attach knowledge bases. Mirrors the edit dialog's knowledge sub-form —
 * picker popover + linked list — bound to `knowledgeBaseIds`.
 */
export function KnowledgeStep({ form, isSubmitting = false, portalContainer }: KnowledgeStepProps) {
  const openKnowledgePage = useCallback(() => {
    if (isSubmitting) return
    void ipcApi.request('tab.detach', {
      id: uuid(),
      url: '/app/knowledge',
      title: getDefaultRouteTitle('/app/knowledge'),
      type: 'route'
    })
  }, [isSubmitting])

  return (
    <KnowledgeBaseField
      form={form}
      portalContainer={portalContainer}
      formLabel={false}
      disabled={isSubmitting}
      onOpenKnowledgePage={openKnowledgePage}
    />
  )
}

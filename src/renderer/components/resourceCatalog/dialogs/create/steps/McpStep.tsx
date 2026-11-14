import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { McpCapabilityList } from '@renderer/components/resourceCatalog/dialogs/components/McpCapabilityList'

import type { ResourceCreateWizardFormValues } from '../types'

type McpStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  isSubmitting?: boolean
  portalContainer: HTMLElement | null
}

/** Agent MCP servers, bound to `mcpServerIds`. */
export function McpStep({ form, isSubmitting = false, portalContainer }: McpStepProps) {
  const { t } = useTranslation()
  const mcpServerIds = useWatch({ control: form.control, name: 'mcpServerIds' })

  return (
    <McpCapabilityList
      selectedIds={mcpServerIds}
      onSelectedIdsChange={(ids) => form.setValue('mcpServerIds', ids, { shouldDirty: true })}
      emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
      portalContainer={portalContainer}
      disabled={isSubmitting}
    />
  )
}

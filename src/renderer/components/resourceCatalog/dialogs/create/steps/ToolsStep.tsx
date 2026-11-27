import { type UseFormReturn, useWatch } from 'react-hook-form'

import { BuiltinToolsField } from '@renderer/components/resourceCatalog/dialogs/components/BuiltinToolsField'

import type { ResourceCreateWizardFormValues } from '../types'

/** Agent built-in tools, bound to the opt-out `disabledTools`. */
export function ToolsStep({ form }: { form: UseFormReturn<ResourceCreateWizardFormValues> }) {
  const [agentType, disabledTools, knowledgeBaseIds] = useWatch({
    control: form.control,
    name: ['agentType', 'disabledTools', 'knowledgeBaseIds']
  })

  return (
    <BuiltinToolsField
      agentType={agentType}
      disabledTools={disabledTools}
      onDisabledToolsChange={(next) => form.setValue('disabledTools', next, { shouldDirty: true })}
      hasKnowledgeScope={knowledgeBaseIds.length > 0}
    />
  )
}

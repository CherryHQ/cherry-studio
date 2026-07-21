import { FormField, FormItem } from '@cherrystudio/ui'
import { PromptEditorField } from '@renderer/components/PromptEditorField'
import {
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  FieldLabelWithHelp,
  PromptVariablesPopover
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { PromptPolishActions } from '@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions'
import { RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import { useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

type PersonaStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/**
 * Step 2 (shared by assistant + agent): the system prompt / persona. Just the
 * prompt editor — advanced settings stay in the edit dialog by design.
 */
export function PersonaStep({ form, portalContainer }: PersonaStepProps) {
  const { t } = useTranslation()
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const name = useWatch({ control: form.control, name: 'name' })

  return (
    <FormField
      control={form.control}
      name="prompt"
      render={({ field }) => (
        <FormItem className="flex h-full min-h-0 flex-col">
          <PromptEditorField
            actions={
              <PromptPolishActions
                value={field.value}
                fallbackSource={name}
                emptyValueSystemPrompt={AGENT_PROMPT}
                existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
                onChange={(value) => {
                  field.onChange(value)
                  setResetPreviewKey((key) => key + 1)
                }}
              />
            }
            label={
              <FieldLabelWithHelp
                label={t('library.config.prompt.label')}
                formLabel={false}
                helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
              />
            }
            value={field.value}
            onChange={field.onChange}
            resetPreviewKey={resetPreviewKey}
            placeholder={t('library.config.prompt.placeholder')}
            minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
            maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
            autoFocus
            fill
          />
        </FormItem>
      )}
    />
  )
}

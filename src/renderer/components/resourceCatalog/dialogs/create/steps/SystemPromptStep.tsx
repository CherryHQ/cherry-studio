import { useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FormField, FormItem } from '@cherrystudio/ui'
import { PromptEditorField } from '@renderer/components/PromptEditorField'
import {
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  FieldLabelWithHelp,
  PromptVariablesPopover
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { PromptPolishActions } from '@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions'
import { useModelById } from '@renderer/hooks/useModel'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import { AGENT_PROMPT } from '@shared/ai/prompts'

import type { ResourceCreateWizardFormValues } from '../types'

type SystemPromptStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  /** Fill the step's height; off when other fields follow the editor. */
  fill?: boolean
  placeholder?: string
}

/** The System Prompt editor: the Assistant's step 2, and the top of the advanced step for Agents not on Pi Durable. */
export function SystemPromptStep({ form, portalContainer, fill = true, placeholder }: SystemPromptStepProps) {
  const { t } = useTranslation()
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const [polishing, setPolishing] = useState(false)
  const name = useWatch({ control: form.control, name: 'name' })
  const modelId = useWatch({ control: form.control, name: 'modelId' })
  const prompt = useWatch({ control: form.control, name: 'prompt' })
  const { model } = useModelById(modelId)
  const processedPrompt = usePromptProcessor({ prompt, modelName: model?.name })

  return (
    <FormField
      control={form.control}
      name="prompt"
      render={({ field }) => (
        <FormItem className={fill ? 'flex h-full min-h-0 flex-col' : undefined}>
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
                onRunningChange={setPolishing}
              />
            }
            label={
              <FieldLabelWithHelp
                label={t('library.config.prompt.label')}
                labelClassName="font-medium"
                formLabel={false}
                helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
              />
            }
            value={field.value}
            onChange={field.onChange}
            previewValue={processedPrompt || prompt}
            resetPreviewKey={resetPreviewKey}
            placeholder={placeholder ?? t('library.config.prompt.placeholder')}
            minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
            maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
            autoFocus
            fill={fill}
            disabled={polishing}
          />
        </FormItem>
      )}
    />
  )
}

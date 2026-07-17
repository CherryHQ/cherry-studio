import { FormField, FormItem } from '@cherrystudio/ui'
import { PromptEditorField } from '@renderer/components/PromptEditorField'
import {
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  FieldLabelWithHelp,
  PromptVariablesPopover
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { PromptPolishActions } from '@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

type PersonaStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  onPolishingChange: (polishing: boolean) => void
}

/**
 * Step 2 (shared by assistant + agent): the system prompt / persona. Just the
 * prompt editor — advanced settings stay in the edit dialog by design.
 */
export function PersonaStep({ form, portalContainer, onPolishingChange }: PersonaStepProps) {
  const { t } = useTranslation()
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
                onChange={field.onChange}
                onPolishingChange={onPolishingChange}
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

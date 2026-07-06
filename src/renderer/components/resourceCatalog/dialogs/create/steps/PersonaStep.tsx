import { FormField, FormItem } from '@cherrystudio/ui'
import { PromptEditorField } from '@renderer/components/PromptEditorField'
import {
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  FieldLabelWithHelp,
  PromptVariablesPopover
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import type { UseFormReturn } from 'react-hook-form'
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

  return (
    <FormField
      control={form.control}
      name="prompt"
      render={({ field }) => (
        <FormItem>
          <PromptEditorField
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
          />
        </FormItem>
      )}
    />
  )
}

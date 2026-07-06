import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import {
  AvatarField,
  CompactModelField,
  type ModelLabels,
  TextInputField
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

const EMPTY_MODEL_LABELS: ModelLabels = { modelId: null, planModelId: null, smallModelId: null }

const AGENT_RUNTIME_OPTIONS: { value: AgentType; labelKey: string; labelFallback: string }[] = [
  {
    value: 'claude-code',
    labelKey: 'library.config.agent.field.runtime.option.claude_code',
    labelFallback: 'Claude Code'
  },
  { value: 'pi', labelKey: 'library.config.agent.field.runtime.option.pi', labelFallback: 'pi' }
]

type ModelFieldProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
}

type BasicInfoStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: (model: Model) => boolean
  /** Agent create flows expose a runtime selector that drives the model filter (D8). */
  runtimeSelectable?: boolean
}

/**
 * Runtime selector + model picker for agent create flows. Isolated into its own
 * component so `useAgentModelFilter` (and its provider subscription) only mounts
 * for agents — assistants keep using the static `modelFilter` prop and never
 * touch the agent-runtime filter.
 */
function AgentRuntimeModelFields({ form, portalContainer, modelLabels, setModelLabels }: ModelFieldProps) {
  const { t } = useTranslation()
  const agentType = form.watch('agentType')
  const runtimeFilter = useAgentModelFilter(agentType)

  const handleRuntimeChange = (next: AgentType) => {
    form.setValue('agentType', next, { shouldDirty: true })
    // A model compatible with one runtime may be unsupported by another, so
    // clear the current pick to force a re-select against the new filter.
    form.setValue('modelId', null, { shouldDirty: true })
    setModelLabels(EMPTY_MODEL_LABELS)
  }

  return (
    <>
      <FormField
        control={form.control}
        name="agentType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('library.config.agent.field.runtime.label')}</FormLabel>
            <Select value={field.value} onValueChange={(value) => handleRuntimeChange(value as AgentType)}>
              <FormControl>
                <SelectTrigger aria-label={t('library.config.agent.field.runtime.label')}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent portalContainer={portalContainer}>
                {AGENT_RUNTIME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey, option.labelFallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agentType === 'pi' ? (
              <FormDescription className="text-xs">{t('library.config.agent.field.runtime.pi_hint')}</FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />
      <CompactModelField
        form={form}
        name="modelId"
        label={t('common.model')}
        filter={runtimeFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
      />
    </>
  )
}

/**
 * Step 1 (shared by assistant + agent): avatar, name, model, description.
 * Reuses the edit-dialog field components verbatim — field names match. Owns its
 * own emoji-picker and model-label state so selecting a model/avatar re-renders
 * only this step, never the dialog shell (keeps DialogContent's ref stable).
 */
export function BasicInfoStep({
  form,
  portalContainer,
  fallbackAvatar,
  modelFilter,
  runtimeSelectable = false
}: BasicInfoStepProps) {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_1fr] items-start gap-3">
        <AvatarField
          form={form}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
          fallback={fallbackAvatar}
          portalContainer={portalContainer}
          size="sm"
        />
        <TextInputField
          form={form}
          name="name"
          label={t('common.name')}
          placeholder={t('library.config.dialogs.create.name_placeholder')}
          required
        />
      </div>

      {runtimeSelectable ? (
        <AgentRuntimeModelFields
          form={form}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
        />
      ) : (
        <CompactModelField
          form={form}
          name="modelId"
          label={t('common.model')}
          filter={modelFilter}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
        />
      )}

      <TextInputField
        form={form}
        name="description"
        label={t('common.description')}
        placeholder={t('library.config.dialogs.create.description_placeholder')}
      />
    </div>
  )
}

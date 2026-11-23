import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FormControl, FormField, FormItem, FormLabel, Textarea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AgentPromptField } from '@renderer/components/resourceCatalog/dialogs/components/AgentPromptField'
import { settingsPillClassName } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogPages'
import { HeartbeatCard } from '@renderer/components/resourceCatalog/dialogs/components/HeartbeatCard'
import { ReplyLanguageSelect } from '@renderer/components/resourceCatalog/dialogs/components/ReplyLanguageSelect'
import { useModelById } from '@renderer/hooks/useModel'
import type { AgentCreateSettings } from '@shared/ai/agentForm'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'

import type { ResourceCreateWizardFormValues } from '../types'

type AdvancedStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/** Agent's last step: System Prompt, reply language, heartbeat (when the runtime has one), and env vars. */
export function AdvancedStep({ form, portalContainer }: AdvancedStepProps) {
  const { t } = useTranslation()
  const [
    agentType,
    modelId,
    name,
    prompt,
    skillIds,
    disabledTools,
    knowledgeBaseIds,
    claudeCodeNativePromptEnabled,
    languageMode,
    languageCustom,
    heartbeatEnabled,
    heartbeatInterval,
    heartbeatTimeoutMinutes
  ] = useWatch({
    control: form.control,
    name: [
      'agentType',
      'modelId',
      'name',
      'prompt',
      'skillIds',
      'disabledTools',
      'knowledgeBaseIds',
      'claudeCodeNativePromptEnabled',
      'languageMode',
      'languageCustom',
      'heartbeatEnabled',
      'heartbeatInterval',
      'heartbeatTimeoutMinutes'
    ]
  })
  const { model } = useModelById(modelId)
  const patch = (values: Partial<AgentCreateSettings>) => {
    for (const [key, value] of Object.entries(values)) {
      form.setValue(key as keyof AgentCreateSettings, value, { shouldDirty: true })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AgentPromptField
        value={prompt}
        onChange={(value) => form.setValue('prompt', value, { shouldDirty: true })}
        name={name}
        modelName={model?.name}
        portalContainer={portalContainer}
        onNativePromptEnabledChange={(enabled) => patch({ claudeCodeNativePromptEnabled: enabled })}
        draft={{
          agentType,
          claudeCodeNativePromptEnabled,
          skillIds,
          disabledTools,
          knowledgeBaseIds,
          languageMode,
          languageCustom
        }}
        heading={<h3 className="-mb-2 font-medium text-foreground text-sm">{t('library.config.prompt.label')}</h3>}
      />
      {/* Same row as the edit window: name left, compact select right, "Other language…" input below. */}
      <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-border-subtle px-3 py-2.5 [&>input]:col-span-2 [&>input]:mt-2">
        <span className="text-foreground text-sm">{t('library.config.agent.field.language.label')}</span>
        <ReplyLanguageSelect
          value={{ languageMode, languageCustom }}
          onChange={patch}
          portalContainer={portalContainer}
          triggerClassName={cn(settingsPillClassName, 'w-auto')}
        />
      </div>
      {AGENT_RUNTIME_CAPABILITIES[agentType].heartbeat ? (
        <HeartbeatCard
          value={{ heartbeatEnabled, heartbeatInterval, heartbeatTimeoutMinutes }}
          onChange={patch}
          description={t('library.config.dialogs.create.heartbeat_description')}
        />
      ) : null}
      <FormField
        control={form.control}
        name="envVarsText"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="gap-1.5">
              {t('library.config.agent.field.env_vars.label')}
              <span className="font-normal text-muted-foreground text-xs">
                {t('library.config.agent.field.env_vars.help')}
              </span>
            </FormLabel>
            <FormControl>
              <Textarea.Input
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('library.config.agent.field.env_vars.placeholder')}
                rows={4}
                className="min-h-24 font-mono text-xs md:text-xs"
              />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  )
}

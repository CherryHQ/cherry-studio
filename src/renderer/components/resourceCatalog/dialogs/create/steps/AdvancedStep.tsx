import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FormControl, FormField, FormItem, FormLabel, Label, Textarea } from '@cherrystudio/ui'
import { HeartbeatCard } from '@renderer/components/resourceCatalog/dialogs/components/HeartbeatCard'
import { ReplyLanguageSelect } from '@renderer/components/resourceCatalog/dialogs/components/ReplyLanguageSelect'
import type { AgentCreateSettings } from '@renderer/types/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'

import type { ResourceCreateWizardFormValues } from '../types'
import { SystemPromptStep } from './SystemPromptStep'

type AdvancedStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/** Agent's last step: System Prompt, reply language, heartbeat (when the runtime has one), and env vars. */
export function AdvancedStep({ form, portalContainer }: AdvancedStepProps) {
  const { t } = useTranslation()
  const [agentType, languageMode, languageCustom, heartbeatEnabled, heartbeatInterval, heartbeatTimeoutMinutes] =
    useWatch({
      control: form.control,
      name: [
        'agentType',
        'languageMode',
        'languageCustom',
        'heartbeatEnabled',
        'heartbeatInterval',
        'heartbeatTimeoutMinutes'
      ]
    })
  const patch = (values: Partial<AgentCreateSettings>) => {
    for (const [key, value] of Object.entries(values)) {
      form.setValue(key as keyof AgentCreateSettings, value, { shouldDirty: true })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SystemPromptStep form={form} portalContainer={portalContainer} fill={false} />
      <div className="grid gap-2">
        <Label>{t('library.config.agent.field.language.label')}</Label>
        <ReplyLanguageSelect
          value={{ languageMode, languageCustom }}
          onChange={patch}
          portalContainer={portalContainer}
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

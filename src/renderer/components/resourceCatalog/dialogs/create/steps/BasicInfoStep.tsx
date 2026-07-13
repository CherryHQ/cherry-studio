import {
  Button,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
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
import { ipcApi } from '@renderer/ipc'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

const EMPTY_MODEL_LABELS: ModelLabels = { modelId: null, planModelId: null, smallModelId: null }

const AGENT_RUNTIME_OPTIONS: { value: AgentType; labelKey: string; labelFallback: string }[] = Object.entries(
  AGENT_RUNTIME_CAPABILITIES
).map(([value, caps]) => ({ value: value as AgentType, labelKey: caps.labelKey, labelFallback: caps.labelFallback }))

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
  const caps = AGENT_RUNTIME_CAPABILITIES[agentType]

  const handleRuntimeChange = (next: AgentType) => {
    form.setValue('agentType', next, { shouldDirty: true })
    form.setValue('modelId', null, { shouldDirty: true })
    form.setValue('stellaRemoteAgentId', '', { shouldDirty: true })
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
            {caps.hintKey ? <FormDescription className="text-xs">{t(caps.hintKey)}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        )}
      />
      {caps.remoteAgentSelection ? (
        <StellaConnectionFields form={form} portalContainer={portalContainer} />
      ) : (
        <CompactModelField
          form={form}
          name="modelId"
          label={t('common.model')}
          filter={runtimeFilter}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
        />
      )}
    </>
  )
}

function StellaConnectionFields({ form, portalContainer }: Omit<ModelFieldProps, 'modelLabels' | 'setModelLabels'>) {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<Array<{ id: string; name: string; description?: string; avatar?: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configureAndList = async () => {
    setLoading(true)
    setError(null)
    try {
      const { stellaEndpoint, stellaPat } = form.getValues()
      await ipcApi.request('stella.configure_connection', { endpoint: stellaEndpoint, pat: stellaPat })
      const remoteAgents = await ipcApi.request('stella.list_agents')
      setAgents(remoteAgents)
      form.setValue('stellaPat', '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('library.config.dialogs.create.submit_failed'))
    } finally {
      setLoading(false)
    }
  }

  const selectRemoteAgent = (id: string) => {
    const remote = agents.find((agent) => agent.id === id)
    if (!remote) return
    form.setValue('stellaRemoteAgentId', remote.id, { shouldDirty: true })
    form.setValue('name', remote.name, { shouldDirty: true })
    form.setValue('description', remote.description ?? '', { shouldDirty: true })
    if (remote.avatar) form.setValue('avatar', remote.avatar, { shouldDirty: true })
  }

  return (
    <div className="grid gap-3 rounded-md border border-border-muted p-3">
      <FormField
        control={form.control}
        name="stellaEndpoint"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('library.config.agent.field.stella.endpoint')}</FormLabel>
            <FormControl>
              <Input {...field} placeholder="https://stella.example" />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="stellaPat"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('library.config.agent.field.stella.pat')}</FormLabel>
            <FormControl>
              <Input {...field} type="password" autoComplete="off" />
            </FormControl>
          </FormItem>
        )}
      />
      <Button type="button" variant="outline" loading={loading} onClick={() => void configureAndList()}>
        {t('library.config.agent.field.stella.connect')}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {agents.length > 0 ? (
        <FormField
          control={form.control}
          name="stellaRemoteAgentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('library.config.agent.field.stella.remote_agent')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(id) => {
                  field.onChange(id)
                  selectRemoteAgent(id)
                }}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent portalContainer={portalContainer}>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
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

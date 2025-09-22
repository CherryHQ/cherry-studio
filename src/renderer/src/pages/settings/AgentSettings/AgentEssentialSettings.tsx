import { Button, Tooltip } from '@heroui/react'
import { loggerService } from '@logger'
import { ApiModelLabel } from '@renderer/components/ApiModelLabel'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentEntity, UpdateAgentForm } from '@renderer/types'
import { Input, Select } from 'antd'
import { DefaultOptionType } from 'antd/es/select'
import { Plus } from 'lucide-react'
import { FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentLabel, SettingsContainer, SettingsItem, SettingsTitle } from './shared'

const logger = loggerService.withContext('AgentEssentialSettings')

interface AgentEssentialSettingsProps {
  agent: AgentEntity | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())
  const { models } = useApiModels({ providerType: 'anthropic' })
  const agentModel = models.find((model) => model.id === agent?.model)

  const updateName = (name: string) => {
    if (!agent) return
    update({ id: agent.id, name: name.trim() })
  }

  const updateModel = (model: UpdateAgentForm['model']) => {
    if (!agent) return
    update({ id: agent.id, model })
  }

  const updateAccessiblePaths = useCallback(
    (accessible_paths: UpdateAgentForm['accessible_paths']) => {
      if (!agent) return
      update({ id: agent.id, accessible_paths })
    },
    [agent, update]
  )

  const modelOptions = useMemo(() => {
    return models.map((model) => ({
      value: model.id,
      label: <ApiModelLabel model={model} />
    })) satisfies DefaultOptionType[]
  }, [models])

  const addAccessiblePath = useCallback(async () => {
    if (!agent) return

    try {
      const selected = await window.api.file.selectFolder()
      if (!selected) {
        return
      }

      if (agent.accessible_paths.includes(selected)) {
        window.toast.warning(t('agent.session.accessible_paths.duplicate'))
        return
      }

      updateAccessiblePaths([...agent.accessible_paths, selected])
    } catch (error) {
      logger.error('Failed to select accessible path:', error as Error)
      window.toast.error(t('agent.session.accessible_paths.select_failed'))
    }
  }, [agent, t, updateAccessiblePaths])

  const removeAccessiblePath = useCallback(
    (path: string) => {
      if (!agent) return
      const newPaths = agent.accessible_paths.filter((p) => p !== path)
      if (newPaths.length === 0) {
        window.toast.error(t('agent.session.accessible_paths.error.at_least_one'))
        return
      }
      updateAccessiblePaths(newPaths)
    },
    [agent, t, updateAccessiblePaths]
  )

  if (!agent) return null

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.type.label')}</SettingsTitle>
        <AgentLabel type={agent.type} />
      </SettingsItem>
      <SettingsItem inline>
        <SettingsTitle>{t('common.name')}</SettingsTitle>
        <Input
          placeholder={t('common.agent_one') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== agent.name) {
              updateName(name)
            }
          }}
          className="max-w-80 flex-1"
        />
      </SettingsItem>
      <SettingsItem inline className="gap-8">
        <SettingsTitle>{t('common.model')}</SettingsTitle>
        <Select
          options={modelOptions}
          value={agent.model}
          onChange={(value) => {
            updateModel(value)
          }}
          className="max-w-80 flex-1"
          placeholder={t('common.placeholders.select.model')}
        />
      </SettingsItem>
      {/* TODO: Add accessible_paths and description */}
      <SettingsItem>
        <SettingsTitle
          actions={
            <Tooltip content={t('agent.session.accessible_paths.add')}>
              <Button size="sm" startContent={<Plus />} isIconOnly onPress={addAccessiblePath} />
            </Tooltip>
          }>
          {t('agent.session.accessible_paths.label')}
        </SettingsTitle>
        <ul className="mt-2 flex flex-col gap-2 rounded-xl border p-2">
          {agent.accessible_paths.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between gap-2 rounded-medium border border-default-200 px-3 py-2">
              <span className="truncate text-sm" title={path}>
                {path}
              </span>
              <Button size="sm" variant="light" color="danger" onPress={() => removeAccessiblePath(path)}>
                {t('common.delete')}
              </Button>
            </li>
          ))}
        </ul>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentEssentialSettings

import { Button, Chip, Select as HeroSelect, SelectedItems, SelectItem, Tooltip } from '@heroui/react'
import { loggerService } from '@logger'
import type { Selection } from '@react-types/shared'
import { ApiModelLabel } from '@renderer/components/ApiModelLabel'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { GetAgentResponse, Tool, UpdateAgentForm } from '@renderer/types'
import { Input, Select } from 'antd'
import { DefaultOptionType } from 'antd/es/select'
import { Plus } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentLabel, SettingsContainer, SettingsItem, SettingsTitle } from './shared'

const logger = loggerService.withContext('AgentEssentialSettings')

interface AgentEssentialSettingsProps {
  agent: GetAgentResponse | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())
  const { models } = useApiModels({ providerType: 'anthropic' })
  const availableTools = useMemo(() => agent?.tools ?? [], [agent?.tools])
  const [allowedToolIds, setAllowedToolIds] = useState<string[]>([])
  const selectedToolKeys = useMemo<Selection>(() => new Set<string>(allowedToolIds), [allowedToolIds])

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

  const updateAllowedTools = useCallback(
    (allowed_tools: UpdateAgentForm['allowed_tools']) => {
      if (!agent) return
      update({ id: agent.id, allowed_tools })
    },
    [agent, update]
  )

  const modelOptions = useMemo(() => {
    return models.map((model) => ({
      value: model.id,
      label: <ApiModelLabel model={model} />
    })) satisfies DefaultOptionType[]
  }, [models])

  useEffect(() => {
    if (!agent) {
      setAllowedToolIds((prev) => (prev.length === 0 ? prev : []))
      return
    }

    const allowed = agent.allowed_tools ?? []
    const filtered = availableTools.length
      ? allowed.filter((id) => availableTools.some((tool) => tool.id === id))
      : allowed

    setAllowedToolIds((prev) => {
      const prevSet = new Set(prev)
      const isSame = filtered.length === prevSet.size && filtered.every((id) => prevSet.has(id))
      if (isSame) {
        return prev
      }
      return filtered
    })
  }, [agent, availableTools])

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

  const renderSelectedTools = useCallback((items: SelectedItems<Tool>) => {
    if (!items.length) {
      return null
    }

    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Chip key={item.key} size="sm" variant="flat" className="max-w-[160px] truncate">
            {item.data?.name ?? item.textValue ?? item.key}
          </Chip>
        ))}
      </div>
    )
  }, [])

  const onAllowedToolsChange = useCallback(
    (keys: Selection) => {
      if (!agent) return

      const nextIds = keys === 'all' ? availableTools.map((tool) => tool.id) : Array.from(keys).map(String)
      const filtered = availableTools.length
        ? nextIds.filter((id) => availableTools.some((tool) => tool.id === id))
        : nextIds

      setAllowedToolIds((prev) => {
        const prevSet = new Set(prev)
        const isSame = filtered.length === prevSet.size && filtered.every((id) => prevSet.has(id))
        if (isSame) {
          return prev
        }
        return filtered
      })

      const previous = agent.allowed_tools ?? []
      const previousSet = new Set(previous)
      const isSameSelection = filtered.length === previousSet.size && filtered.every((id) => previousSet.has(id))

      if (isSameSelection) {
        return
      }

      updateAllowedTools(filtered)
    },
    [agent, availableTools, updateAllowedTools]
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
      <SettingsItem>
        <SettingsTitle>{t('agent.session.allowed_tools.label')}</SettingsTitle>
        <HeroSelect
          aria-label={t('agent.session.allowed_tools.label')}
          selectionMode="multiple"
          selectedKeys={selectedToolKeys}
          onSelectionChange={onAllowedToolsChange}
          placeholder={t('agent.session.allowed_tools.placeholder')}
          description={
            availableTools.length
              ? t('agent.session.allowed_tools.helper')
              : t('agent.session.allowed_tools.empty')
          }
          isDisabled={!availableTools.length}
          items={availableTools}
          renderValue={renderSelectedTools}
          className="max-w-xl">
          {(tool) => (
            <SelectItem key={tool.id} textValue={tool.name}>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{tool.name}</span>
                {tool.description ? (
                  <span className="text-xs text-foreground-500">{tool.description}</span>
                ) : null}
              </div>
            </SelectItem>
          )}
        </HeroSelect>
      </SettingsItem>
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

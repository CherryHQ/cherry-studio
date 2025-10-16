import {
  Button,
  Form,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectedItemProps,
  SelectItem,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { loggerService } from '@logger'
import type { Selection } from '@react-types/shared'
import ClaudeIcon from '@renderer/assets/images/models/claude.png'
import { getModelLogo } from '@renderer/config/models'
import { permissionModeCards } from '@renderer/constants/permissionModes'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import {
  AddAgentForm,
  AgentConfigurationSchema,
  AgentEntity,
  AgentType,
  BaseAgentForm,
  isAgentType,
  PermissionMode,
  Tool,
  UpdateAgentForm
} from '@renderer/types'
import { AlertTriangleIcon } from 'lucide-react'
import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorBoundary } from '../../ErrorBoundary'
import { BaseOption, ModelOption, Option, renderOption } from './shared'

const logger = loggerService.withContext('AddAgentPopup')

interface AgentTypeOption extends BaseOption {
  type: 'type'
  key: AgentEntity['type']
  name: AgentEntity['name']
}

type Option = AgentTypeOption | ModelOption

type AgentWithTools = AgentEntity & { tools?: Tool[] }

const buildAgentForm = (existing?: AgentWithTools): BaseAgentForm => ({
  type: existing?.type ?? 'claude-code',
  name: existing?.name ?? 'Claude Code',
  description: existing?.description,
  instructions: existing?.instructions,
  model: existing?.model ?? 'claude-4-sonnet',
  accessible_paths: existing?.accessible_paths ? [...existing.accessible_paths] : [],
  allowed_tools: existing?.allowed_tools ? [...existing.allowed_tools] : [],
  mcps: existing?.mcps ? [...existing.mcps] : [],
  configuration: AgentConfigurationSchema.parse(existing?.configuration ?? {})
})

interface BaseProps {
  agent?: AgentWithTools
}

interface TriggerProps extends BaseProps {
  children: ReactNode
  isOpen?: never
  onClose?: never
}

interface StateProps extends BaseProps {
  children?: never
  isOpen: boolean
  onClose: () => void
}

type Props = TriggerProps | StateProps

/**
 * Modal component for creating or editing an agent.
 *
 * Either trigger or isOpen and onClose is given.
 * @param agent - Optional agent entity for editing mode.
 * @param children - Optional trigger element that opens the modal. It MUST propagate the click event to trigger the modal.
 * @param isOpen - Optional controlled modal open state. From useDisclosure.
 * @param onClose - Optional callback when modal closes. From useDisclosure.
 * @returns Modal component for agent creation/editing
 */
export const AgentModal: React.FC<Props> = ({ agent, children, isOpen: _isOpen, onClose: _onClose }) => {
  const { isOpen, onClose, onOpen } = useDisclosure({ isOpen: _isOpen, onClose: _onClose })
  const { t } = useTranslation()
  const loadingRef = useRef(false)
  // const { setTimeoutTimer } = useTimer()
  const { addAgent } = useAgents()
  const { updateAgent } = useUpdateAgent()
  // hard-coded. We only support anthropic for now.
  const { models } = useApiModels({ supportAnthropic: true })
  const isEditing = (agent?: AgentWithTools) => agent !== undefined

  const [form, setForm] = useState<BaseAgentForm>(() => buildAgentForm(agent))

  useEffect(() => {
    if (isOpen) {
      setForm(buildAgentForm(agent))
    }
  }, [agent, isOpen])

  const selectedPermissionMode = form.configuration?.permission_mode ?? 'default'

  const onPermissionModeChange = useCallback((keys: Selection) => {
    if (keys === 'all') {
      return
    }

    const [first] = Array.from(keys)
    if (!first) {
      return
    }

    setForm((prev) => {
      const parsedConfiguration = AgentConfigurationSchema.parse(prev.configuration ?? {})
      const nextMode = first as PermissionMode

      if (parsedConfiguration.permission_mode === nextMode) {
        if (!prev.configuration) {
          return {
            ...prev,
            configuration: parsedConfiguration
          }
        }
        return prev
      }

      return {
        ...prev,
        configuration: {
          ...parsedConfiguration,
          permission_mode: nextMode
        }
      }
    })
  }, [])

  // add supported agents type here.
  const agentConfig = useMemo(
    () =>
      [
        {
          type: 'type',
          key: 'claude-code',
          label: 'Claude Code',
          name: 'Claude Code',
          avatar: ClaudeIcon
        }
      ] as const satisfies AgentTypeOption[],
    []
  )

  const agentOptions: AgentTypeOption[] = useMemo(
    () =>
      agentConfig.map(
        (option) =>
          ({
            ...option,
            rendered: <Option option={option} />
          }) as const satisfies SelectedItemProps
      ),
    [agentConfig]
  )

  const onAgentTypeChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const prevConfig = agentConfig.find((config) => config.key === form.type)
      let newName: string | undefined = form.name
      if (prevConfig && prevConfig.name === form.name) {
        const newConfig = agentConfig.find((config) => config.key === e.target.value)
        if (newConfig) {
          newName = newConfig.name
        }
      }
      setForm((prev) => ({
        ...prev,
        type: e.target.value as AgentType,
        name: newName
      }))
    },
    [agentConfig, form.name, form.type]
  )

  const onNameChange = useCallback((name: string) => {
    setForm((prev) => ({
      ...prev,
      name
    }))
  }, [])

  const onDescChange = useCallback((description: string) => {
    setForm((prev) => ({
      ...prev,
      description
    }))
  }, [])

  const onInstChange = useCallback((instructions: string) => {
    setForm((prev) => ({
      ...prev,
      instructions
    }))
  }, [])

  const addAccessiblePath = useCallback(async () => {
    try {
      const selected = await window.api.file.selectFolder()
      if (!selected) {
        return
      }
      setForm((prev) => {
        if (prev.accessible_paths.includes(selected)) {
          window.toast.warning(t('agent.session.accessible_paths.duplicate'))
          return prev
        }
        return {
          ...prev,
          accessible_paths: [...prev.accessible_paths, selected]
        }
      })
    } catch (error) {
      logger.error('Failed to select accessible path:', error as Error)
      window.toast.error(t('agent.session.accessible_paths.select_failed'))
    }
  }, [t])

  const removeAccessiblePath = useCallback((path: string) => {
    setForm((prev) => ({
      ...prev,
      accessible_paths: prev.accessible_paths.filter((item) => item !== path)
    }))
  }, [])

  const modelOptions = useMemo(() => {
    // mocked data. not final version
    return (models ?? []).map((model) => ({
      type: 'model',
      key: model.id,
      label: model.name,
      avatar: getModelLogo(model.id),
      providerId: model.provider,
      providerName: model.provider_name
    })) satisfies ModelOption[]
  }, [models])

  const onModelChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setForm((prev) => ({
      ...prev,
      model: e.target.value
    }))
  }, [])

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (loadingRef.current) {
        return
      }

      loadingRef.current = true

      // Additional validation check besides native HTML validation to ensure security
      if (!isAgentType(form.type)) {
        window.toast.error(t('agent.add.error.invalid_agent'))
        loadingRef.current = false
        return
      }
      if (!form.model) {
        window.toast.error(t('error.model.not_exists'))
        loadingRef.current = false
        return
      }

      if (form.accessible_paths.length === 0) {
        window.toast.error(t('agent.session.accessible_paths.error.at_least_one'))
        loadingRef.current = false
        return
      }

      if (isEditing(agent)) {
        if (!agent) {
          loadingRef.current = false
          throw new Error('Agent is required for editing mode')
        }

        const updatePayload = {
          id: agent.id,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          model: form.model,
          accessible_paths: [...form.accessible_paths],
          allowed_tools: [...form.allowed_tools],
          configuration: form.configuration ? { ...form.configuration } : undefined
        } satisfies UpdateAgentForm

        updateAgent(updatePayload)
        logger.debug('Updated agent', updatePayload)
      } else {
        const newAgent = {
          type: form.type,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          model: form.model,
          accessible_paths: [...form.accessible_paths],
          allowed_tools: [...form.allowed_tools],
          configuration: form.configuration ? { ...form.configuration } : undefined
        } satisfies AddAgentForm
        const result = await addAgent(newAgent)
        if (!result.success) {
          loadingRef.current = false
          throw result.error
        }
      }

      loadingRef.current = false

      // setTimeoutTimer('onCreateAgent', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      onClose()
    },
    [
      form.type,
      form.model,
      form.name,
      form.description,
      form.instructions,
      form.accessible_paths,
      form.allowed_tools,
      form.configuration,
      agent,
      onClose,
      t,
      updateAgent,
      addAgent
    ]
  )

  return (
    <ErrorBoundary>
      {/* NOTE: Hero UI Modal Pattern: Combine the Button and Modal components into a single
      encapsulated component. This is because the Modal component needs to bind the onOpen
      event handler to the Button for proper focus management.

      Or just use external isOpen/onOpen/onClose to control modal state.
      */}

      {
        <div
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}>
          {children}
        </div>
      }
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        classNames={{
          base: 'max-h-[90vh]',
          wrapper: 'overflow-hidden'
        }}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{isEditing(agent) ? t('agent.edit.title') : t('agent.add.title')}</ModalHeader>
              <Form onSubmit={onSubmit} className="min-h-0 w-full shrink overflow-auto">
                <ModalBody className="min-h-0 w-full flex-1 shrink overflow-auto">
                  <div className="flex gap-2">
                    <Select
                      isRequired
                      isDisabled={isEditing(agent)}
                      selectionMode="single"
                      selectedKeys={[form.type]}
                      disallowEmptySelection
                      onChange={onAgentTypeChange}
                      items={agentOptions}
                      label={t('agent.type.label')}
                      placeholder={t('agent.add.type.placeholder')}
                      renderValue={renderOption}>
                      {(option) => (
                        <SelectItem key={option.key} textValue={option.label}>
                          <Option option={option} />
                        </SelectItem>
                      )}
                    </Select>
                    <Input isRequired value={form.name} onValueChange={onNameChange} label={t('common.name')} />
                  </div>
                  <Select
                    isRequired
                    selectionMode="single"
                    selectedKeys={form.model ? [form.model] : []}
                    disallowEmptySelection
                    onChange={onModelChange}
                    items={modelOptions}
                    label={t('common.model')}
                    placeholder={t('common.placeholders.select.model')}
                    renderValue={renderOption}>
                    {(option) => (
                      <SelectItem key={option.key} textValue={option.label}>
                        <Option option={option} />
                      </SelectItem>
                    )}
                  </Select>
                  <Select
                    isRequired
                    selectionMode="single"
                    selectedKeys={[selectedPermissionMode]}
                    onSelectionChange={onPermissionModeChange}
                    label={t('agent.settings.tooling.permissionMode.title', 'Permission mode')}
                    placeholder={t('agent.settings.tooling.permissionMode.placeholder', 'Select permission mode')}
                    description={t(
                      'agent.settings.tooling.permissionMode.helper',
                      'Choose how the agent handles tool approvals.'
                    )}
                    items={permissionModeCards}>
                    {(item) => (
                      <SelectItem key={item.mode} textValue={t(item.titleKey, item.titleFallback)}>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-sm">{t(item.titleKey, item.titleFallback)}</span>
                          <span className="text-foreground-500 text-xs">
                            {t(item.descriptionKey, item.descriptionFallback)}
                          </span>
                          <span className="text-foreground-400 text-xs">
                            {t(item.behaviorKey, item.behaviorFallback)}
                          </span>
                          {item.caution ? (
                            <span className="flex items-center gap-1 text-danger-500 text-xs">
                              <AlertTriangleIcon size={12} className="text-danger" />
                              {t(
                                'agent.settings.tooling.permissionMode.bypassPermissions.warning',
                                'Use with caution — all tools will run without asking for approval.'
                              )}
                            </span>
                          ) : null}
                        </div>
                      </SelectItem>
                    )}
                  </Select>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground text-sm">
                        {t('agent.session.accessible_paths.label')}
                      </span>
                      <Button size="sm" variant="flat" onPress={addAccessiblePath}>
                        {t('agent.session.accessible_paths.add')}
                      </Button>
                    </div>
                    {form.accessible_paths.length > 0 ? (
                      <div className="space-y-2">
                        {form.accessible_paths.map((path) => (
                          <div
                            key={path}
                            className="flex items-center justify-between gap-2 rounded-medium border border-default-200 px-3 py-2">
                            <span className="truncate text-sm" title={path}>
                              {path}
                            </span>
                            <Button size="sm" variant="light" color="danger" onPress={() => removeAccessiblePath(path)}>
                              {t('common.delete')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-foreground-400 text-sm">{t('agent.session.accessible_paths.empty')}</p>
                    )}
                  </div>
                  <Textarea label={t('common.prompt')} value={form.instructions ?? ''} onValueChange={onInstChange} />
                  <Textarea
                    label={t('common.description')}
                    value={form.description ?? ''}
                    onValueChange={onDescChange}
                  />
                </ModalBody>
                <ModalFooter className="w-full">
                  <Button onPress={onClose}>{t('common.close')}</Button>
                  <Button color="primary" type="submit" isLoading={loadingRef.current}>
                    {isEditing(agent) ? t('common.confirm') : t('common.add')}
                  </Button>
                </ModalFooter>
              </Form>
            </>
          )}
        </ModalContent>
      </Modal>
    </ErrorBoundary>
  )
}

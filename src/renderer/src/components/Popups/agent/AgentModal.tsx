import {
  Button,
  cn,
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
import ClaudeIcon from '@renderer/assets/images/models/claude.png'
import { getModelLogo } from '@renderer/config/models'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useModels } from '@renderer/hooks/agents/useModels'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AddAgentForm, AgentEntity, AgentType, BaseAgentForm, isAgentType, UpdateAgentForm } from '@renderer/types'
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

const buildAgentForm = (existing?: AgentEntity): BaseAgentForm => ({
  type: existing?.type ?? 'claude-code',
  name: existing?.name ?? 'Claude Code',
  description: existing?.description,
  instructions: existing?.instructions,
  model: existing?.model ?? 'claude-4-sonnet',
  accessible_paths: existing?.accessible_paths ? [...existing.accessible_paths] : []
})

interface BaseProps {
  agent?: AgentEntity
}

interface TriggerProps extends BaseProps {
  trigger: { content: ReactNode; className?: string }
  isOpen?: never
  onClose?: never
}

interface StateProps extends BaseProps {
  trigger?: never
  isOpen: boolean
  onClose: () => void
}

type Props = TriggerProps | StateProps

/**
 * Modal component for creating or editing an agent.
 *
 * Either trigger or isOpen and onClose is given.
 * @param agent - Optional agent entity for editing mode.
 * @param trigger - Optional trigger element that opens the modal. It MUST propagate the click event to trigger the modal.
 * @param isOpen - Optional controlled modal open state. From useDisclosure.
 * @param onClose - Optional callback when modal closes. From useDisclosure.
 * @returns Modal component for agent creation/editing
 */
export const AgentModal: React.FC<Props> = ({ agent, trigger, isOpen: _isOpen, onClose: _onClose }) => {
  const { isOpen, onClose, onOpen } = useDisclosure({ isOpen: _isOpen, onClose: _onClose })
  const { t } = useTranslation()
  const loadingRef = useRef(false)
  // const { setTimeoutTimer } = useTimer()
  const { addAgent } = useAgents()
  const updateAgent = useUpdateAgent()
  // hard-coded. We only support anthropic for now.
  const { models } = useModels({ providerType: 'anthropic' })
  const isEditing = (agent?: AgentEntity) => agent !== undefined

  const [form, setForm] = useState<BaseAgentForm>(() => buildAgentForm(agent))

  useEffect(() => {
    if (isOpen) {
      setForm(buildAgentForm(agent))
    }
  }, [agent, isOpen])

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
        window.toast.error(t('agent.session.accessible_paths.required'))
        loadingRef.current = false
        return
      }

      if (isEditing(agent)) {
        if (!agent) {
          throw new Error('Agent is required for editing mode')
        }

        const updatePayload = {
          id: agent.id,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          model: form.model,
          accessible_paths: [...form.accessible_paths]
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
          accessible_paths: [...form.accessible_paths]
        } satisfies AddAgentForm
        addAgent(newAgent)
        logger.debug('Added agent', newAgent)
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

      {trigger && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className={cn('w-full', trigger.className)}>
          {trigger.content}
        </div>
      )}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{isEditing(agent) ? t('agent.edit.title') : t('agent.add.title')}</ModalHeader>
              <Form onSubmit={onSubmit} className="w-full">
                <ModalBody className="w-full">
                  <Select
                    isRequired
                    isDisabled={isEditing(agent)}
                    selectionMode="single"
                    selectedKeys={[form.type]}
                    onChange={onAgentTypeChange}
                    items={agentOptions}
                    label={t('agent.add.type.label')}
                    placeholder={t('agent.add.type.placeholder')}
                    renderValue={renderOption}>
                    {(option) => (
                      <SelectItem key={option.key} textValue={option.label}>
                        <Option option={option} />
                      </SelectItem>
                    )}
                  </Select>
                  <Input isRequired value={form.name} onValueChange={onNameChange} label={t('common.name')} />
                  {/* FIXME: Model type definition is string. It cannot be related to provider. Just mock a model now. */}
                  <Select
                    isRequired
                    selectionMode="single"
                    selectedKeys={form.model ? [form.model] : []}
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
                  <Textarea
                    label={t('common.description')}
                    value={form.description ?? ''}
                    onValueChange={onDescChange}
                  />
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

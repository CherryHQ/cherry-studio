import {
  Avatar,
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
  SelectedItems,
  SelectItem,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { loggerService } from '@logger'
import ClaudeIcon from '@renderer/assets/images/models/claude.png'
import { useAgents } from '@renderer/hooks/useAgents'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { AgentEntity, AgentType, isAgentType } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { ChangeEvent, FormEvent, ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorBoundary } from '../ErrorBoundary'

const logger = loggerService.withContext('AddAgentPopup')

interface Option {
  key: string
  label: string
  // img src
  avatar: string
}

interface AgentTypeOption extends Option {
  key: AgentEntity['type']
  name: AgentEntity['name']
}

type ModelOption = Option

type AgentForm = {
  type: AgentEntity['type']
  name: AgentEntity['name']
  description?: AgentEntity['description']
  instructions?: AgentEntity['instructions']
  model?: AgentEntity['model']
}

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
  const { setTimeoutTimer } = useTimer()
  const { addAgent, updateAgent } = useAgents()
  const isEditing = (agent?: AgentEntity) => agent !== undefined

  // default values. may change to undefined.
  const [form, setForm] = useState<AgentForm>(
    isEditing(agent)
      ? agent
      : {
          type: 'claude-code',
          name: 'Claude Code',
          model: 'claude-4-sonnet'
        }
  )

  const Option = useCallback(
    ({ option }: { option?: Option | null }) => {
      if (!option) {
        return (
          <div className="flex gap-2">
            <Avatar name="?" className="h-5 w-5" />
            {t('common.invalid_value')}
          </div>
        )
      }
      return (
        <div className="flex gap-2">
          <Avatar src={option.avatar} className="h-5 w-5" />
          {option.label}
        </div>
      )
    },
    [t]
  )

  const Item = useCallback(({ item }: { item: SelectedItemProps<Option> }) => <Option option={item.data} />, [Option])

  const renderOption = useCallback(
    (items: SelectedItems<Option>) => items.map((item) => <Item key={item.key} item={item} />),
    [Item]
  )

  // add supported agents type here.
  const agentConfig = useMemo(
    () =>
      [
        {
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
    [Option, agentConfig]
  )

  const onAgentTypeChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const prevConfig = agentConfig.find((config) => config.key === form.type)
      let newName: string = form.name
      if (prevConfig && prevConfig.name === form.name) {
        const newConfig = agentConfig.find((config) => config.key === e.target.value)
        if (newConfig) {
          newName = newConfig.name
        }
      }
      setForm((prev) => ({
        ...prev,
        type: e.target.value as AgentForm['type'],
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

  const modelOptions = useMemo(() => {
    // mocked data. not final version
    return [
      {
        key: 'claude-4-sonnet',
        label: 'Claude 4 Sonnet',
        avatar: ClaudeIcon
      }
    ] satisfies ModelOption[]
  }, [])

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
        return
      }
      if (form.model === undefined) {
        window.toast.error(t('error.model.not_exists'))
        return
      }

      let _agent: AgentEntity
      if (isEditing(agent)) {
        _agent = {
          ...agent,
          // type: form.type,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          updated_at: new Date().toISOString(),
          model: form.model
          // avatar: getAvatar(form.type)
        } satisfies AgentEntity
        updateAgent(_agent)
        window.toast.success(t('common.update_success'))
      } else {
        _agent = {
          id: uuid(),
          type: form.type,
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          model: form.model,
          avatar: getAvatar(form.type)
        } satisfies AgentEntity
        addAgent(_agent)
        window.toast.success(t('common.add_success'))
      }

      logger.debug('Agent', _agent)
      loadingRef.current = false

      setTimeoutTimer('onCreateAgent', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      onClose()
    },
    [
      form.type,
      form.model,
      form.name,
      form.description,
      form.instructions,
      agent,
      setTimeoutTimer,
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
                  <Textarea label={t('common.description')} value={form.description} onValueChange={onDescChange} />
                  <Textarea label={t('common.prompt')} value={form.instructions} onValueChange={onInstChange} />
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

const getAvatar = (type: AgentType) => {
  switch (type) {
    case 'claude-code':
      return ClaudeIcon
  }
  return undefined
}

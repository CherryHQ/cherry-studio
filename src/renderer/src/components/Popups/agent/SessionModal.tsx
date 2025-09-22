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
  SelectedItems,
  SelectItem,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { loggerService } from '@logger'
import { getModelLogo } from '@renderer/config/models'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { AgentEntity, AgentSessionEntity, BaseSessionForm, CreateSessionForm, UpdateSessionForm } from '@renderer/types'
import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorBoundary } from '../../ErrorBoundary'
import { BaseOption, ModelOption, Option } from './shared'

const logger = loggerService.withContext('SessionAgentPopup')

type Option = ModelOption

const buildSessionForm = (existing?: AgentSessionEntity, agent?: AgentEntity): BaseSessionForm => ({
  name: existing?.name ?? agent?.name ?? 'Claude Code',
  description: existing?.description ?? agent?.description,
  instructions: existing?.instructions ?? agent?.instructions,
  model: existing?.model ?? agent?.model ?? '',
  accessible_paths: existing?.accessible_paths
    ? [...existing.accessible_paths]
    : agent?.accessible_paths
      ? [...agent.accessible_paths]
      : []
})

interface BaseProps {
  agentId: string
  session?: AgentSessionEntity
  onSessionCreated?: (session: AgentSessionEntity) => void
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
 * Modal component for creating or editing a Session.
 *
 * Either trigger or isOpen and onClose is given.
 * @param agentId - The ID of agent which the session is related.
 * @param session - Optional session entity for editing mode.
 * @param trigger - Optional trigger element that opens the modal. It MUST propagate the click event to trigger the modal.
 * @param isOpen - Optional controlled modal open state. From useDisclosure.
 * @param onClose - Optional callback when modal closes. From useDisclosure.
 * @returns Modal component for agent creation/editing
 */
export const SessionModal: React.FC<Props> = ({
  agentId,
  session,
  trigger,
  isOpen: _isOpen,
  onClose: _onClose,
  onSessionCreated
}) => {
  const { isOpen, onClose, onOpen } = useDisclosure({ isOpen: _isOpen, onClose: _onClose })
  const { t } = useTranslation()
  const loadingRef = useRef(false)
  // const { setTimeoutTimer } = useTimer()
  const { createSession, updateSession } = useSessions(agentId)
  // Only support claude code for now
  const { models } = useApiModels({ providerType: 'anthropic' })
  const { agent } = useAgent(agentId)
  const isEditing = (session?: AgentSessionEntity) => session !== undefined

  const [form, setForm] = useState<BaseSessionForm>(() => buildSessionForm(session, agent ?? undefined))

  useEffect(() => {
    if (isOpen) {
      setForm(buildSessionForm(session, agent ?? undefined))
    }
  }, [session, agent, isOpen])

  const Item = useCallback(({ item }: { item: SelectedItemProps<BaseOption> }) => <Option option={item.data} />, [])

  const renderOption = useCallback(
    (items: SelectedItems<BaseOption>) => items.map((item) => <Item key={item.key} item={item} />),
    [Item]
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

      try {
        if (isEditing(session)) {
          if (!session) {
            throw new Error('Agent is required for editing mode')
          }

          const updatePayload = {
            id: session.id,
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            model: form.model,
            accessible_paths: [...form.accessible_paths]
          } satisfies UpdateSessionForm

          updateSession(updatePayload)
          logger.debug('Updated agent', updatePayload)
        } else {
          const newSession = {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            model: form.model,
            accessible_paths: [...form.accessible_paths]
          } satisfies CreateSessionForm
          const createdSession = await createSession(newSession)
          if (createdSession) {
            onSessionCreated?.(createdSession)
          }
          logger.debug('Added agent', newSession)
        }

        // setTimeoutTimer('onCreateAgent', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
        onClose()
      } finally {
        loadingRef.current = false
      }
    },
    [
      form.model,
      form.name,
      form.description,
      form.instructions,
      form.accessible_paths,
      session,
      onClose,
      onSessionCreated,
      t,
      updateSession,
      createSession
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
              <ModalHeader>
                {isEditing(session) ? t('agent.session.edit.title') : t('agent.session.add.title')}
              </ModalHeader>
              <Form onSubmit={onSubmit} className="w-full">
                <ModalBody className="w-full">
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
                  <Textarea label={t('common.prompt')} value={form.instructions ?? ''} onValueChange={onInstChange} />
                </ModalBody>
                <ModalFooter className="w-full">
                  <Button onPress={onClose}>{t('common.close')}</Button>
                  <Button color="primary" type="submit" isLoading={loadingRef.current}>
                    {isEditing(session) ? t('common.confirm') : t('common.add')}
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

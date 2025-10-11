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
  Textarea,
  useDisclosure
} from '@heroui/react'
import { loggerService } from '@logger'
import type { Selection } from '@react-types/shared'
import { AllowedToolsSelect } from '@renderer/components/agent'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import type {
  AgentEntity,
  AgentSessionEntity,
  BaseSessionForm,
  CreateSessionForm,
  Tool,
  UpdateSessionForm
} from '@renderer/types'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorBoundary } from '../../ErrorBoundary'

const logger = loggerService.withContext('SessionAgentPopup')

type AgentWithTools = AgentEntity & { tools?: Tool[] }
type SessionWithTools = AgentSessionEntity & { tools?: Tool[] }

const buildSessionForm = (existing?: SessionWithTools, agent?: AgentWithTools): BaseSessionForm => ({
  name: existing?.name ?? agent?.name ?? 'Claude Code',
  description: existing?.description ?? agent?.description,
  instructions: existing?.instructions ?? agent?.instructions,
  model: existing?.model ?? agent?.model ?? '',
  accessible_paths: existing?.accessible_paths
    ? [...existing.accessible_paths]
    : agent?.accessible_paths
      ? [...agent.accessible_paths]
      : [],
  allowed_tools: existing?.allowed_tools
    ? [...existing.allowed_tools]
    : agent?.allowed_tools
      ? [...agent.allowed_tools]
      : [],
  mcps: existing?.mcps ? [...existing.mcps] : agent?.mcps ? [...agent.mcps] : []
})

interface BaseProps {
  agentId: string
  session?: SessionWithTools
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
 * @deprecated may as a reference when migrating to v2
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
  const { createSession } = useSessions(agentId)
  const updateSession = useUpdateSession(agentId)
  const { agent } = useAgent(agentId)
  const isEditing = (session?: AgentSessionEntity) => session !== undefined

  const [form, setForm] = useState<BaseSessionForm>(() => buildSessionForm(session, agent ?? undefined))

  useEffect(() => {
    if (isOpen) {
      setForm(buildSessionForm(session, agent ?? undefined))
    }
  }, [session, agent, isOpen])

  const availableTools = useMemo(() => session?.tools ?? agent?.tools ?? [], [agent?.tools, session?.tools])
  const selectedToolKeys = useMemo(() => new Set(form.allowed_tools ?? []), [form.allowed_tools])

  useEffect(() => {
    if (!availableTools.length) {
      return
    }

    setForm((prev) => {
      const allowed = prev.allowed_tools ?? []
      const validTools = allowed.filter((id) => availableTools.some((tool) => tool.id === id))
      if (validTools.length === allowed.length) {
        return prev
      }
      return {
        ...prev,
        allowed_tools: validTools
      }
    })
  }, [availableTools])

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

  const onAllowedToolsChange = useCallback(
    (keys: Selection) => {
      setForm((prev) => {
        const existing = prev.allowed_tools ?? []
        if (keys === 'all') {
          return {
            ...prev,
            allowed_tools: availableTools.map((tool) => tool.id)
          }
        }

        const next = Array.from(keys).map(String)
        const filtered = availableTools.length
          ? next.filter((id) => availableTools.some((tool) => tool.id === id))
          : next

        if (existing.length === filtered.length && existing.every((id) => filtered.includes(id))) {
          return prev
        }

        return {
          ...prev,
          allowed_tools: filtered
        }
      })
    },
    [availableTools]
  )

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
        window.toast.error(t('agent.session.accessible_paths.error.at_least_one'))
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
            accessible_paths: [...form.accessible_paths],
            allowed_tools: [...(form.allowed_tools ?? [])],
            mcps: [...(form.mcps ?? [])]
          } satisfies UpdateSessionForm

          updateSession(updatePayload)
          logger.debug('Updated agent', updatePayload)
        } else {
          const newSession = {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            model: form.model,
            accessible_paths: [...form.accessible_paths],
            allowed_tools: [...(form.allowed_tools ?? [])],
            mcps: [...(form.mcps ?? [])]
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
      form.allowed_tools,
      form.mcps,
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
                  <Textarea
                    label={t('common.description')}
                    value={form.description ?? ''}
                    onValueChange={onDescChange}
                  />
                  <AllowedToolsSelect
                    items={availableTools}
                    selectedKeys={selectedToolKeys}
                    onSelectionChange={onAllowedToolsChange}
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

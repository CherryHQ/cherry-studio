import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { isWin } from '@renderer/config/constant'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useTimer } from '@renderer/hooks/useTimer'
import { useSystemAssistantPresets } from '@renderer/pages/store/assistants/presets'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AddAgentForm, AgentEntity, Assistant, AssistantPreset, BaseAgentForm } from '@renderer/types'
import { isAgentType } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { cn } from '@renderer/utils'
import type { InputRef } from 'antd'
import { Button, Input, Modal, Tag } from 'antd'
import { take } from 'lodash'
import { Bot, MessageSquare } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Scrollbar from '../Scrollbar'
import AgentForm, { buildAgentForm } from './agent/AgentForm'

const logger = loggerService.withContext('AddAssistantPopup')

type Mode = 'assistant' | 'agent'

export interface AddAssistantPopupResult {
  type: 'assistant' | 'agent'
  assistant?: Assistant
  agent?: AgentEntity
}

interface ShowParams {
  defaultMode?: Mode
  showModeSwitch?: boolean
}

interface Props extends ShowParams {
  resolve: (value: AddAssistantPopupResult | undefined) => void
}

const PopupContainer: React.FC<Props> = ({ resolve, defaultMode = 'assistant', showModeSwitch = true }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>(defaultMode)

  // Assistant mode state
  const { presets: userPresets } = useAssistantPresets()
  const [searchText, setSearchText] = useState('')
  const { defaultAssistant } = useDefaultAssistant()
  const { assistants, addAssistant } = useAssistants()
  const inputRef = useRef<InputRef>(null)
  const systemPresets = useSystemAssistantPresets()
  const loadingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { setTimeoutTimer } = useTimer()

  // Agent mode state
  const [agentForm, setAgentForm] = useState<BaseAgentForm>(() => buildAgentForm())
  const { addAgent } = useAgents()

  const presets = useMemo(() => {
    const allPresets = [...userPresets, ...systemPresets] as AssistantPreset[]
    const list = [defaultAssistant, ...allPresets.filter((preset) => !assistants.map((a) => a.id).includes(preset.id))]
    const filtered = searchText
      ? list.filter(
          (preset) =>
            preset.name.toLowerCase().includes(searchText.trim().toLocaleLowerCase()) ||
            preset.description?.toLowerCase().includes(searchText.trim().toLocaleLowerCase())
        )
      : list

    if (searchText.trim()) {
      const newAgent: AssistantPreset = {
        id: 'new',
        name: searchText.trim(),
        prompt: '',
        topics: [],
        type: 'assistant',
        emoji: '⭐️'
      }
      return [newAgent, ...filtered]
    }
    return filtered
  }, [assistants, defaultAssistant, searchText, systemPresets, userPresets])

  const onCreateAssistant = useCallback(
    async (preset: AssistantPreset) => {
      if (loadingRef.current) {
        return
      }

      loadingRef.current = true

      try {
        let assistant: Assistant

        if (preset.id === 'default') {
          assistant = { ...preset, id: uuid() }
          addAssistant(assistant)
        } else {
          assistant = await createAssistantFromAgent(preset)
        }

        setTimeoutTimer('onCreateAssistant', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
        resolve({ type: 'assistant', assistant })
        setOpen(false)
      } catch (error) {
        logger.error('Failed to create assistant:', error as Error)
        window.toast.error(t('assistant.add.error.failed', 'Failed to create assistant'))
      } finally {
        loadingRef.current = false
      }
    },
    [setTimeoutTimer, resolve, addAssistant, t]
  )

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    AddAssistantPopup.hide()
    TopView.hide('AddAssistantPopup')
  }

  // Agent form submission
  const onSubmitAgent = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (loadingRef.current) {
        return
      }

      loadingRef.current = true

      if (!isAgentType(agentForm.type)) {
        window.toast.error(t('agent.add.error.invalid_agent'))
        loadingRef.current = false
        return
      }
      if (!agentForm.model) {
        window.toast.error(t('error.model.not_exists'))
        loadingRef.current = false
        return
      }

      if (agentForm.accessible_paths.length === 0) {
        window.toast.error(t('agent.session.accessible_paths.error.at_least_one'))
        loadingRef.current = false
        return
      }

      if (isWin) {
        try {
          const pathInfo = await window.api.system.getGitBashPathInfo()
          if (!pathInfo.path) {
            window.toast.error(t('agent.gitBash.error.required', 'Git Bash path is required on Windows'))
            loadingRef.current = false
            return
          }
        } catch (error) {
          logger.error('Failed to check Git Bash:', error as Error)
          loadingRef.current = false
          return
        }
      }

      const newAgent = {
        type: agentForm.type,
        name: agentForm.name,
        description: agentForm.description,
        instructions: agentForm.instructions,
        model: agentForm.model,
        accessible_paths: [...agentForm.accessible_paths],
        allowed_tools: [...agentForm.allowed_tools],
        configuration: agentForm.configuration ? { ...agentForm.configuration } : undefined
      } satisfies AddAgentForm

      const result = await addAgent(newAgent)

      if (!result.success) {
        loadingRef.current = false
        window.toast.error(result.error?.message || t('agent.add.error.failed'))
        return
      }

      resolve({ type: 'agent', agent: result.data })
      loadingRef.current = false
      setOpen(false)
    },
    [agentForm, t, addAgent, resolve]
  )

  AddAssistantPopup.hide = onCancel

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      title={t('chat.add.option.title')}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 20
        },
        body: {
          padding: 0
        }
      }}
      width={520}
      footer={null}>
      {showModeSwitch && (
        <ModeSelector>
          <ModeCard $active={mode === 'assistant'} onClick={() => setMode('assistant')}>
            <ModeIconWrapper $active={mode === 'assistant'}>
              <MessageSquare
                size={20}
                className={cn(
                  'transition-colors',
                  mode === 'assistant' ? 'text-[var(--color-primary)]' : 'text-[var(--color-icon-white)]'
                )}
              />
            </ModeIconWrapper>
            <ModeCardContent>
              <ModeCardTitle>{t('chat.add.assistant.title')}</ModeCardTitle>
              <ModeCardDesc>{t('chat.add.assistant.description')}</ModeCardDesc>
            </ModeCardContent>
          </ModeCard>
          <ModeCard $active={mode === 'agent'} onClick={() => setMode('agent')}>
            <ModeIconWrapper $active={mode === 'agent'}>
              <Bot
                size={20}
                className={cn(
                  'transition-colors',
                  mode === 'agent' ? 'text-[var(--color-primary)]' : 'text-[var(--color-icon-white)]'
                )}
              />
            </ModeIconWrapper>
            <ModeCardContent>
              <ModeCardTitle>{t('agent.add.title')}</ModeCardTitle>
              <ModeCardDesc>{t('agent.add.description')}</ModeCardDesc>
            </ModeCardContent>
          </ModeCard>
        </ModeSelector>
      )}

      {mode === 'assistant' && (
        <>
          <Container ref={containerRef}>
            <Input
              ref={inputRef}
              placeholder={t('assistants.search')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ marginBottom: 12, marginTop: 2, height: 36 }}
              variant="outlined"
            />
            {take(presets, 100).map((preset) => (
              <PresetCard key={preset.id} onClick={() => onCreateAssistant(preset)} className="agent-item">
                <PresetCardBackground>{preset.emoji || ''}</PresetCardBackground>
                <PresetCardHeader>
                  <PresetCardInfo>
                    <PresetCardTitle>{preset.name}</PresetCardTitle>
                    <PresetCardTags>
                      {preset.id === 'default' && <Tag color="green">{t('assistants.presets.tag.system')}</Tag>}
                      {preset.type === 'agent' && <Tag color="orange">{t('assistants.presets.tag.agent')}</Tag>}
                      {preset.id === 'new' && <Tag color="green">{t('assistants.presets.tag.new')}</Tag>}
                    </PresetCardTags>
                  </PresetCardInfo>
                  <PresetCardEmoji>{preset.emoji || ''}</PresetCardEmoji>
                </PresetCardHeader>
                {(preset.description || preset.prompt) && (
                  <PresetCardDesc>
                    {(preset.description || preset.prompt || '').substring(0, 100).replace(/\\n/g, '')}
                  </PresetCardDesc>
                )}
              </PresetCard>
            ))}
          </Container>
        </>
      )}

      {mode === 'agent' && (
        <StyledForm onSubmit={onSubmitAgent}>
          <AgentForm form={agentForm} setForm={setAgentForm} />
          <FormFooter>
            <Button onClick={onCancel}>{t('common.close')}</Button>
            <Button type="primary" htmlType="submit" loading={loadingRef.current}>
              {t('common.add')}
            </Button>
          </FormFooter>
        </StyledForm>
      )}
    </Modal>
  )
}

const ModeSelector = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 5px 16px 12px;
`

const ModeCard = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid ${(props) => (props.$active ? 'var(--color-primary-soft)' : 'transparent')};
  background-color: var(--color-background-soft);
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
`

const ModeIconWrapper = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--color-list-item);
  flex-shrink: 0;
`

const ModeCardContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
`

const ModeCardTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
`

const ModeCardDesc = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  line-height: 1.4;
`

const Container = styled(Scrollbar)`
  padding: 0 15px;
  height: 55vh;
`

const PresetCard = styled.div`
  border-radius: var(--list-item-border-radius);
  cursor: pointer;
  border: 1px solid var(--color-border-soft);
  padding: 12px;
  overflow: hidden;
  margin-bottom: 8px;
  position: relative;
  transition:
    box-shadow 0.2s ease,
    background-color 0.2s ease;
`

const PresetCardBackground = styled.div`
  position: absolute;
  top: 0;
  right: -30px;
  font-size: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0.08;
  filter: blur(15px);
`

const PresetCardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  position: relative;
`

const PresetCardInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
`

const PresetCardTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const PresetCardTags = styled.div`
  display: flex;
  flex-direction: row;
  gap: 4px;
  flex-wrap: wrap;
`

const PresetCardEmoji = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  font-size: 20px;
  flex-shrink: 0;
  background-color: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
`

const PresetCardDesc = styled.div`
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-2);
  margin-top: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
`

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 16px;
  height: 55vh;
`

const FormFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`

export default class AddAssistantPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddAssistantPopup')
  }
  static show(params: ShowParams = {}) {
    return new Promise<AddAssistantPopupResult | undefined>((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={resolve} />, 'AddAssistantPopup')
    })
  }
}

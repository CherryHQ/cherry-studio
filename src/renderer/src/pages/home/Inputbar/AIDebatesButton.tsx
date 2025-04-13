import {
  CheckCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  WarningOutlined
} from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useTopicLoading, useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import { Assistant, Message, Topic } from '@renderer/types'
import { abortCompletion } from '@renderer/utils/abortController'
import { Button, Col, Divider, Popover, Row, Select, Slider, Switch, Tooltip } from 'antd'
import { throttle } from 'lodash'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  topic: Topic
  isTextEmpty: boolean
  ToolbarButton: typeof Button
  disabled?: boolean
  sendMessage: () => void
  onStreamContent: (content: string) => void
  onRunning: (isRunning: boolean) => void
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

interface StatusHints {
  message: string
  type: 'info' | 'finish' | 'error'
  round?: number
  totalRounds?: number
}

type RunningStatus = 'generating' | 'finish'

/**
 * AIDebatesButton Component
 *  This component implements an AI debate feature that
 *  allows two AI assistants to debate with each other.
 */
const AIDebatesButton: FC<Props> = ({
  assistant,
  topic,
  isTextEmpty,
  ToolbarButton,
  disabled = false,
  sendMessage,
  onStreamContent,
  /** Notify parent component of running status */
  onRunning,
  setActiveTopic,
  setActiveAssistant
}) => {
  /** the topic's assistant */
  const topicAssistant = useRef<Assistant | null>(null)
  /** the topic which debates running in */
  const runningTopic = useRef<Topic | null>(null)
  /** the assistant which debates use */
  const runningAssistant = useRef<Assistant | null>(null)

  const originalMessages = useTopicMessages(runningTopic.current || topic)
  /** reverse messages role for AI Debates */
  const reverseMessagesRef = useRef<Message[]>([])

  /** user selected assistant other than topic assistant */
  const [alterAssistant, setAlterAssistant] = useState<Assistant | null>(null)
  const { assistants: userPredefinedAssistants } = useAssistants()

  const [isPopoverShow, setIsPopoverShow] = useState(false)
  const [autoMode, setAutoMode] = useState<boolean>(false)
  const [autoRounds, setAutoRounds] = useState<number>(3)

  const isReplyLoading = useTopicLoading(runningTopic.current || topic)
  const [isRunning, setIsRunning] = useState(false)
  const [statusHints, setStatusHints] = useState<StatusHints | null>(null)

  const runningStatus = useRef<RunningStatus>('finish')
  const runningId = useRef<string | undefined>(undefined)

  const { t } = useTranslation()

  /** the assistant which debates use */
  const targetAssistant = runningAssistant.current || alterAssistant || assistant

  /** reverse messages role for AI Debates */
  useEffect(() => {
    reverseMessagesRef.current = originalMessages.map((msg) => ({
      ...msg,
      role: msg.role === 'assistant' ? 'user' : msg.role === 'user' ? 'assistant' : msg.role
    }))

    /**
     * Since the user/assistant relationship will be filtered multiple times
     * in subsequent processing, and to minimize changes to deep-level code,
     * we make a temporary fix here to preserve the user's original information
     */
    if (
      reverseMessagesRef.current[0] &&
      reverseMessagesRef.current[0].role === 'assistant' &&
      reverseMessagesRef.current[1] &&
      reverseMessagesRef.current[1].role === 'user'
    ) {
      // Merge the content of the first message into the second message
      reverseMessagesRef.current[1].content =
        reverseMessagesRef.current[0].content + '\n\n' + reverseMessagesRef.current[1].content
      // Remove the first message
      reverseMessagesRef.current.shift()
    }

    /** if the messages are empty, add a nearly 'empty' user message */
    if (reverseMessagesRef.current.length == 0) {
      const userMessage = getUserMessage({
        assistant: targetAssistant,
        topic: runningTopic.current || topic,
        type: 'text',
        content: '...'
      })

      reverseMessagesRef.current.push(userMessage)
    }
  }, [originalMessages, targetAssistant, topic])

  /** set the running status and take related actions */
  const setRunningStatus = (status: RunningStatus) => {
    switch (status) {
      case 'generating':
        setIsRunning(true)
        onRunning(true)
        /** fix those setting, avoid changing when user route to other topic/assistant */
        topicAssistant.current = assistant
        runningTopic.current = topic
        runningAssistant.current = targetAssistant
        break
      case 'finish':
        /** delayed to set isRunning to remain the hints
         *  set onRunning to inform the parent component to update the status
         */
        onRunning(false)
        topicAssistant.current = null
        runningTopic.current = null
        runningAssistant.current = null
        setTimeout(closeFinishPopover, 2000)
        break
    }
    runningStatus.current = status
  }

  /** subscribe the reply message event, and execute the callback */
  const handleReceiveReplyMessage = (callback: () => void) => {
    /** subscribe the receive message event */
    const unsubscribe = EventEmitter.on(EVENT_NAMES.RECEIVE_MESSAGE, (msg) => {
      /** make sure the message is from the current topic */
      if (msg.topicId !== runningTopic.current?.id) {
        return
      }
      unsubscribe()

      /** if the reply message is error, ai debates will end */
      if (msg.status === 'error') {
        setStatusHints({
          type: 'error',
          message: t('chat.aidebates.hints.error')
        })
        setRunningStatus('finish')
        return
      }

      callback()
    })
  }

  /** The main function to execute the AI Debates */
  const execute = async (autoMode: boolean = false, totalRounds: number = 1, currentRound: number = 1) => {
    try {
      /** finish the round */
      if (autoMode && currentRound > totalRounds) {
        setRunningStatus('finish')
        setStatusHints({
          type: 'finish',
          message: t('chat.aidebates.hints.finish')
        })
        return
      }

      setRunningStatus('generating')

      if (autoMode) {
        setStatusHints({
          type: 'info',
          message: t('chat.aidebates.hints.generating_automode'),
          round: currentRound,
          totalRounds: totalRounds
        })
      } else {
        setStatusHints({
          type: 'info',
          message: t('chat.aidebates.hints.generating')
        })
      }

      /** init assistant message */
      const assistantMessage = getAssistantMessage({
        assistant: runningAssistant.current as Assistant,
        topic: runningTopic.current as Topic
      })

      /** set Ids, in order to cancel those fetch task */
      const lastUserMessage = reverseMessagesRef.current.findLast((m) => m.role === 'user')
      assistantMessage.askId = lastUserMessage?.id
      runningId.current = lastUserMessage?.id

      /** throttle the stream content */
      const throttledStreamContent = throttle(
        (content: string) => {
          onStreamContent(content)
        },
        120,
        { trailing: true }
      )

      await fetchChatCompletion({
        message: assistantMessage,
        messages: reverseMessagesRef.current,
        assistant: runningAssistant.current as Assistant,
        onResponse: async (msg) => {
          switch (msg.status) {
            case 'pending':
              throttledStreamContent(msg.content)
              break
            case 'success':
              {
                onStreamContent(msg.content)

                if (!autoMode) {
                  setStatusHints({
                    type: 'finish',
                    message: t('chat.aidebates.hints.finish')
                  })
                  setRunningStatus('finish')
                  return
                }
                /** Below is in autoMode */

                /** go on to send the generated message */
                sendMessage()

                /** if the current round is the last round,
                 *  set the status to finish earlier
                 */
                if (currentRound === totalRounds) {
                  setStatusHints({
                    type: 'finish',
                    message: t('chat.aidebates.hints.finish_automode')
                  })
                  setRunningStatus('finish')
                  return
                }

                setStatusHints({
                  type: 'info',
                  message: t('chat.aidebates.hints.response_waiting'),
                  round: currentRound,
                  totalRounds: totalRounds
                })

                /** the callback when the reply message is received */
                const receiveHandler = () => {
                  setStatusHints({
                    type: 'info',
                    message: t('chat.aidebates.hints.response_received'),
                    round: currentRound,
                    totalRounds: totalRounds
                  })

                  /** go on to the next round */
                  setTimeout(() => {
                    execute(autoMode, totalRounds, currentRound + 1)
                  }, 500)
                }

                handleReceiveReplyMessage(receiveHandler)
              }
              break
            case 'error':
              setStatusHints({
                type: 'error',
                message: t('chat.aidebates.hints.error')
              })
              setRunningStatus('finish')
              return
          }
        }
      })
    } catch (error) {
      console.error('AI Debates with Errors:', error)
      setStatusHints({
        type: 'error',
        message: t('chat.aidebates.hints.error')
      })
      setRunningStatus('finish')
      return
    }
  }

  const notEmptyTextConfirm = () => {
    return window?.modal?.confirm({
      title: t('chat.aidebates.title'),
      content: t('chat.aidebates.hints.not_empty_text'),
      centered: true
    })
  }

  const handleExecute = async () => {
    /** if the input is empty, execute the AI Debates now*/
    if (isTextEmpty) {
      execute(autoMode, autoRounds)
      return
    }

    /** if the input is not empty, confirm the user whether to execute the AI Debates */
    if (!(await notEmptyTextConfirm())) {
      return
    }

    /** not empty and confirmed, send the user input message first */
    setRunningStatus('generating')

    setStatusHints({
      type: 'info',
      message: t('chat.aidebates.hints.user_message_response')
    })

    sendMessage()

    handleReceiveReplyMessage(() => {
      setTimeout(() => {
        execute(autoMode, autoRounds)
      }, 500)
    })
  }

  /** stop the AI Debates */
  const stopExecute = () => {
    if (runningId.current) {
      /** abort the fetch task */
      abortCompletion(runningId.current)
    }
    setRunningStatus('finish')
    setStatusHints({
      type: 'finish',
      message: t('chat.aidebates.hints.stopped')
    })
  }

  /** select the assistant for AI Debates */
  const handleSelectAlterAssistant = (selectedAssistant: Assistant) => {
    if (!selectedAssistant) return

    if (selectedAssistant.id === assistant.id) {
      setAlterAssistant(null)
    } else {
      setAlterAssistant(selectedAssistant)
    }
  }

  /** if finish, go on set running */
  const closeFinishPopover = () => {
    if (runningStatus.current === 'finish') {
      setIsRunning(false)
      setIsPopoverShow(false)
    }
  }

  const PopoverStatus = (
    <Col>
      <StatusContainer>
        {statusHints?.type === 'finish' && <CheckCircleOutlined style={{ color: 'var(--color-primary-soft)' }} />}
        {statusHints?.type === 'error' && <WarningOutlined style={{ color: 'var(--color-error)' }} />}
        {statusHints?.type === 'info' && <LoadingOutlined />}
        <StatusText>
          {statusHints?.message}
          {statusHints?.round && statusHints?.totalRounds && ` (${statusHints.round}/${statusHints.totalRounds})`}
        </StatusText>
        {runningStatus.current === 'generating' && (
          <Tooltip placement="top" title={t('chat.aidebates.stop')} arrow>
            <Button type="text" size="small" shape="circle" onClick={stopExecute}>
              <PauseCircleOutlined style={{ color: 'var(--color-error)', fontSize: 16 }} />
            </Button>
          </Tooltip>
        )}
        {runningStatus.current === 'finish' && (
          <Button type="text" size="small" shape="circle" onClick={closeFinishPopover}>
            <CloseOutlined style={{ color: 'var(--color-gray-1)', fontSize: 14 }} />
          </Button>
        )}
      </StatusContainer>
      {runningStatus.current === 'generating' && runningTopic.current?.id !== topic.id && (
        <Row>
          <Spacer />
          <Button
            type="text"
            size="small"
            variant="text"
            style={{ fontSize: 12, color: 'var(--color-text-3)' }}
            onClick={() => {
              setActiveAssistant(topicAssistant.current as Assistant)
              setActiveTopic(runningTopic.current as Topic)
            }}>
            {t('chat.aidebates.return_topic')}
          </Button>
        </Row>
      )}
    </Col>
  )

  const PopoverSettings = (
    <SettingsContainer>
      <Section>
        <SectionHeader>
          <SectionTitle>
            <span>{t('assistants.abbr')}</span>
            <Tooltip placement="top" title={t('chat.aidebates.question.assistant')} arrow>
              <QuestionIcon />
            </Tooltip>
          </SectionTitle>
          {alterAssistant && (
            <ResetButton size="small" onClick={() => setAlterAssistant(null)}>
              {t('chat.aidebates.use_topic_assistant')}
            </ResetButton>
          )}
        </SectionHeader>
        <Select
          value={alterAssistant?.id || assistant.id}
          onChange={(value) => {
            const selected = userPredefinedAssistants.find((a) => a.id === value) || assistant
            handleSelectAlterAssistant(selected)
          }}
          style={{ width: '100%' }}
          dropdownRender={(menu) => menu}>
          <Select.Option key={assistant.id} value={assistant.id}>
            <AssistantItem>
              <ModelAvatar model={assistant.model || getDefaultModel()} size={18} />
              <AssistantName>{assistant.name}</AssistantName>
              <Spacer />
              <CurrentTag isCurrent={!alterAssistant}>{t('chat.aidebates.topic_assistant')}</CurrentTag>
            </AssistantItem>
          </Select.Option>
          {userPredefinedAssistants
            .filter((a) => a.id !== assistant.id)
            .map((a) => (
              <Select.Option key={a.id} value={a.id}>
                <AssistantItem>
                  <ModelAvatar model={a.model || getDefaultModel()} size={18} />
                  <AssistantName>{a.name}</AssistantName>
                  <Spacer />
                </AssistantItem>
              </Select.Option>
            ))}
        </Select>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>
            <span>{t('chat.aidebates.auto_mode')}</span>
            <Tooltip placement="top" title={t('chat.aidebates.question.auto_mode')} arrow>
              <QuestionIcon />
            </Tooltip>
          </SectionTitle>
          <Switch size="small" checked={autoMode} onChange={setAutoMode} />
        </SectionHeader>
      </Section>

      {autoMode && (
        <Section>
          <SectionHeader>
            <SectionTitle>
              <span>
                {t('chat.aidebates.rounds')}: {autoRounds}
              </span>
            </SectionTitle>
          </SectionHeader>
          <Slider
            min={1}
            max={8}
            value={autoRounds}
            onChange={(value) => setAutoRounds(value)}
            marks={{ 1: '1', 3: '3', 5: '5', 8: '8' }}
          />
          <HintText>{t('chat.aidebates.mind_token_consumption')}</HintText>
        </Section>
      )}

      <div>
        <HintText>{t('chat.aidebates.hints.running_noop')}</HintText>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      <ButtonGroup>
        <Button onClick={() => setIsPopoverShow(false)}>{t('common.cancel')}</Button>
        <Button type="primary" icon={<CheckOutlined />} disabled={isReplyLoading} onClick={handleExecute}>
          {t('chat.aidebates.start')}
        </Button>
      </ButtonGroup>
    </SettingsContainer>
  )

  const popoverTitle = (
    <PopoverTitleContainer>
      <span style={{ fontWeight: 600 }}>{t('chat.aidebates.title')}</span>
      <Spacer />
      <ExperimentalTag>{t('chat.aidebates.experimental')}</ExperimentalTag>
    </PopoverTitleContainer>
  )

  return (
    <Popover
      content={isRunning ? PopoverStatus : PopoverSettings}
      title={!isRunning && popoverTitle}
      trigger="click"
      open={isRunning || isPopoverShow}
      onOpenChange={setIsPopoverShow}
      placement="topRight"
      arrow={{ pointAtCenter: true }}
      destroyTooltipOnHide>
      <Tooltip
        placement="top"
        title={t('chat.aidebates.title')}
        arrow
        styles={
          isRunning || isPopoverShow
            ? {
                root: { display: 'none' }
              }
            : {}
        }>
        <ToolbarButton
          type="text"
          onClick={() => {
            runningStatus.current === 'finish' && setIsRunning(false)
            setIsPopoverShow(true)
          }}
          disabled={disabled}>
          <LoadingIconWrapper isRunning={isRunning && runningStatus.current === 'generating'}>
            <RobotOutlined />
          </LoadingIconWrapper>
        </ToolbarButton>
      </Tooltip>
    </Popover>
  )
}

const StatusContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 4px;
  white-space: nowrap;
`

const StatusText = styled.span`
  flex: 1;
`

const LoadingIconWrapper = styled.div<{ isRunning: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &::after {
    content: '';
    display: ${(props) => (props.isRunning ? 'block' : 'none')};
    position: absolute;
    top: -4px;
    left: -4px;
    right: -4px;
    bottom: -4px;
    border: 1px solid var(--color-primary);
    border-radius: 50%;
    border-top-color: transparent;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`

const PopoverTitleContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ExperimentalTag = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
`
const SettingsContainer = styled.div`
  width: 280px;
`

const Section = styled.div`
  margin-bottom: 16px;
`

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
`

const ResetButton = styled(Button)`
  padding: 0 8px;
  font-size: 12px;
`

const AssistantItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 28px;
`

const AssistantName = styled.span`
  max-width: calc(100% - 60px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Spacer = styled.span`
  flex: 1;
`

const CurrentTag = styled.span<{ isCurrent: boolean }>`
  color: ${(props) => (props.isCurrent ? 'var(--color-primary)' : 'var(--color-text-3)')};
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
`

const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`

const QuestionIcon = styled(QuestionCircleOutlined)`
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text-3);
`

const HintText = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
  text-align: right;
  display: block;
`

export default AIDebatesButton

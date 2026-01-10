import { TeamOutlined } from '@ant-design/icons'
import { ActionIconButton } from '@renderer/components/Buttons'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import MessageGroupCouncilModal from '@renderer/pages/home/Messages/MessageGroupCouncilModal'
import { useAppSelector } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'

type GroupInfo = {
  askId?: string
  messages: Message[]
  topic: Topic
  autoRun?: boolean
}

const isStage1Candidate = (message: Message) => {
  if (message.role !== 'assistant') return false
  if (message.type === 'committee') return false
  const status = (message.status || '').toString().toLowerCase()
  if (status === 'processing' || status === 'pending' || status === 'searching') {
    return false
  }
  const content = getMainTextContent(message).trim()
  return !!content && !!message.model
}

const isTransmitting = (message: Message) => {
  if (message.role !== 'assistant') return false
  const status = (message.status || '').toString().toLowerCase()
  return status === 'processing' || status === 'pending' || status === 'searching'
}

const llmCommitteeTool = defineTool({
  key: 'llm_committee',
  label: (t) => t('message.committee.label'),
  visibleInScopes: [TopicType.Chat],
  dependencies: {
    state: ['mentionedModels', 'isCommitteeArmed', 'committeePendingAskId', 'committeePendingTopicId'] as const,
    actions: ['setCommitteeArmed', 'setCommitteePendingAskId', 'setCommitteePendingTopicId'] as const
  },
  render: function LlmCommitteeToolRender(context) {
    const { t, assistant, state, actions } = context
    const { mentionedModels, isCommitteeArmed, committeePendingAskId, committeePendingTopicId } = state
    const { setCommitteeArmed, setCommitteePendingAskId, setCommitteePendingTopicId } = actions
    const activeTopic = useAppSelector((state) => state.runtime.chat.activeTopic)
    const currentTopicId = useAppSelector((state) => state.messages.currentTopicId)
    const resolvedTopic = useMemo(() => {
      if (activeTopic) return activeTopic
      if (!currentTopicId) return undefined
      return assistant.topics.find((item) => item.id === currentTopicId)
    }, [activeTopic, assistant.topics, currentTopicId])

    const messages = useAppSelector((state) =>
      resolvedTopic ? selectMessagesForTopic(state, resolvedTopic.id) : []
    )

    const [isOpen, setIsOpen] = useState(false)
    const [activeGroup, setActiveGroup] = useState<GroupInfo | null>(null)
    const [autoRunAskId, setAutoRunAskId] = useState<string | null>(null)

    const canEnable = mentionedModels.length >= 2
    const title = canEnable ? t('message.committee.label') : t('message.committee.warning.need_multi_models')

    useEffect(() => {
      if (!isCommitteeArmed) return
      if (!canEnable) {
        setCommitteeArmed(false)
      }
    }, [canEnable, isCommitteeArmed, setCommitteeArmed])

    useEffect(() => {
      if (!committeePendingAskId || !resolvedTopic) return
      if (committeePendingTopicId && committeePendingTopicId !== resolvedTopic.id) return

      const groupMessages = messages.filter(
        (message) =>
          message.role === 'assistant' && message.askId === committeePendingAskId && message.type !== 'committee'
      )
      if (groupMessages.length === 0) return

      if (groupMessages.some(isTransmitting)) return
      if (groupMessages.filter(isStage1Candidate).length < 2) return

      setActiveGroup({
        askId: committeePendingAskId,
        messages: groupMessages,
        topic: resolvedTopic,
        autoRun: true
      })
      setAutoRunAskId(committeePendingAskId)
      setIsOpen(true)
      setCommitteePendingAskId(null)
      setCommitteePendingTopicId(null)
    }, [
      committeePendingAskId,
      committeePendingTopicId,
      messages,
      resolvedTopic,
      setCommitteePendingAskId,
      setCommitteePendingTopicId
    ])

    const handleToggle = () => {
      if (!canEnable) {
        window.toast.warning(t('message.committee.warning.need_multi_models'))
        return
      }

      const next = !isCommitteeArmed
      setCommitteeArmed(next)
      if (next) {
        setCommitteePendingAskId(null)
        setCommitteePendingTopicId(null)
      }
    }

    return (
      <>
        <Tooltip placement="top" title={title} mouseLeaveDelay={0} arrow>
          <ActionIconButton onClick={handleToggle} disabled={!canEnable} active={isCommitteeArmed}>
            <TeamOutlined />
          </ActionIconButton>
        </Tooltip>
        {activeGroup && (
          <MessageGroupCouncilModal
            key={activeGroup.askId || activeGroup.topic.id}
            open={isOpen}
            onClose={() => setIsOpen(false)}
            messages={activeGroup.messages}
            topic={activeGroup.topic}
            autoRun={autoRunAskId === activeGroup.askId && !!activeGroup.autoRun}
          />
        )}
      </>
    )
  }
})

registerTool(llmCommitteeTool)

export default llmCommitteeTool

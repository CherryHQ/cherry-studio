import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { MentionedAssistant } from '@renderer/types'
import { Tooltip } from 'antd'
import { Bot, Plus } from 'lucide-react'
import { FC, useCallback, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface MentionAssistantsButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<MentionAssistantsButtonRef | null>
  mentionedAssistants: MentionedAssistant[]
  onMentionAssistant: (assistant: any) => void
  ToolbarButton: any
}

const MentionAssistantsButton: FC<Props> = ({ ref, mentionedAssistants, onMentionAssistant, ToolbarButton }) => {
  const { assistants } = useAssistants()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()

  const assistantItems = useCallback(() => {
    const items: QuickPanelListItem[] = assistants.map((asst) => ({
      label: asst.name,
      description: asst.description || '',
      icon: asst.emoji ? <span>{asst.emoji}</span> : <Bot size={18} />,
      action: () => onMentionAssistant(asst),
      isSelected: mentionedAssistants.some((a) => a.id === asst.id)
    }))

    items.push({
      label: t('chat.add.assistant.title') + '...',
      icon: <Plus />,
      action: () => navigate('/settings/assistants'),
      isSelected: false
    })

    return items
  }, [assistants, mentionedAssistants, onMentionAssistant, navigate, t])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('chat.input.mention_assistant'),
      list: assistantItems(),
      symbol: 'mention-assistant',
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [assistantItems, quickPanel, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'mention-assistant') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('chat.input.mention_assistant')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <Bot size={18} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default MentionAssistantsButton

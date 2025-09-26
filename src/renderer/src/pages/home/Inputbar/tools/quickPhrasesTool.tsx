import QuickPhrasesButton from '@renderer/pages/home/Inputbar/QuickPhrasesButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Zap } from 'lucide-react'

const quickPhrasesTool = defineTool({
  key: 'quick_phrases',
  label: (t) => t('settings.quickPhrase.title'),
  icon: Zap,

  visibleInScopes: [TopicType.Chat, 'mini-window'],
  condition: ({ features }) => !!features.enableQuickPhrases,

  dependencies: {
    actions: ['setText', 'resizeTextArea'] as const
  },

  render: (context) => {
    const { assistant, actions, quickPanel } = context

    return (
      <QuickPhrasesButton
        quickPanel={quickPanel}
        setInputValue={actions.setText}
        resizeTextArea={actions.resizeTextArea}
        assistantId={assistant.id}
      />
    )
  }
})

registerTool(quickPhrasesTool)

export default quickPhrasesTool

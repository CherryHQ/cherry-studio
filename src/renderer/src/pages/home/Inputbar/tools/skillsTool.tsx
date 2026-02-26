import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

import SkillsButton from './components/SkillsButton'

const skillsTool = defineTool({
  key: 'skills',
  label: (t) => t('chat.input.skills.title'),
  visibleInScopes: [TopicType.Chat, 'mini-window'],
  dependencies: {
    actions: ['onTextChange', 'resizeTextArea'] as const
  },
  render: (context) => {
    const { assistant, actions, quickPanel } = context
    return (
      <SkillsButton
        quickPanel={quickPanel}
        setInputValue={actions.onTextChange}
        resizeTextArea={actions.resizeTextArea}
        assistantId={assistant.id}
      />
    )
  }
})

registerTool(skillsTool)

export default skillsTool

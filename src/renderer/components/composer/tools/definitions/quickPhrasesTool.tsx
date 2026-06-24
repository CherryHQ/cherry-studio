import { QuickPhrasesToolRuntime } from '@renderer/components/composer/tools/components/QuickPhrasesButton'
import { defineTool, registerTool, TopicType } from '@renderer/components/composer/tools/types'

const quickPhrasesTool = defineTool({
  key: 'quick_phrases',
  label: (t) => t('settings.prompts.title'),

  visibleInScopes: [TopicType.Chat, TopicType.Session, 'quick-assistant', 'painting'],

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    runtime: ({ context }) => {
      const { actions, launcher } = context

      return <QuickPhrasesToolRuntime launcher={launcher} setInputValue={actions.onTextChange} />
    }
  }
})

registerTool(quickPhrasesTool)

export default quickPhrasesTool

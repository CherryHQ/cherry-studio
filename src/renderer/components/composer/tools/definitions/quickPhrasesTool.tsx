import { QuickPhrasesToolRuntime } from '@renderer/components/composer/tools/components/QuickPhrasesButton'
import { QUICK_PHRASES_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'

const quickPhrasesTool = defineTool({
  key: 'quick_phrases',
  label: QUICK_PHRASES_TOOLBAR_MANIFEST.label,

  visibleInScopes: QUICK_PHRASES_TOOLBAR_MANIFEST.visibleInScopes,

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    runtime: ({ context }) => {
      const { actions, assistant, launcher, scope, session } = context

      return (
        <QuickPhrasesToolRuntime
          launcher={launcher}
          setInputValue={actions.onTextChange}
          assistantId={scope === TopicType.Chat || scope === 'quick-assistant' ? assistant?.id : undefined}
          agentId={scope === TopicType.Session ? session?.agentId : undefined}
        />
      )
    }
  }
})

export default quickPhrasesTool

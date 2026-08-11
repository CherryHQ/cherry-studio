import { QuickPhrasesToolRuntime } from '@renderer/components/composer/tools/components/QuickPhrasesButton'
import { QUICK_PHRASES_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { type ComposerToolScope, defineTool, TopicType } from '@renderer/components/composer/tools/types'
import type { PromptBindingTarget } from '@shared/data/types/prompt'

export function resolvePromptBindingTarget(options: {
  scope: ComposerToolScope
  assistantId?: string
  agentId?: string
}): PromptBindingTarget | undefined {
  if (options.scope === TopicType.Session) {
    return options.agentId ? { type: 'agent', id: options.agentId } : undefined
  }
  if (options.scope === TopicType.Chat || options.scope === 'quick-assistant') {
    return options.assistantId ? { type: 'assistant', id: options.assistantId } : undefined
  }
  return undefined
}

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
      const bindingTarget = resolvePromptBindingTarget({
        scope,
        assistantId: assistant?.id,
        agentId: session?.agentId
      })

      return (
        <QuickPhrasesToolRuntime
          launcher={launcher}
          setInputValue={actions.onTextChange}
          bindingTarget={bindingTarget}
        />
      )
    }
  }
})

export default quickPhrasesTool

import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'

import { AgentWebSearchToolRuntime, WebSearchToolRuntime } from '../components/WebSearchButton'

type WebSearchToolContext = ToolRenderContext<readonly [], readonly []>

const WebSearchRuntime = ({ context }: { context: WebSearchToolContext }) => {
  if (context.scope === TopicType.Session) {
    const enabled = context.session?.webSearchEnabled
    const onEnabledChange = context.session?.onWebSearchEnabledChange
    if (enabled === undefined || !onEnabledChange) return null
    return <AgentWebSearchToolRuntime enabled={enabled} launcher={context.launcher} onEnabledChange={onEnabledChange} />
  }

  if (!context.assistant) return null
  return <WebSearchToolRuntime assistantId={context.assistant.id} launcher={context.launcher} />
}

/**
 * Web Search Tool
 *
 * Chat persists the toggle on `assistant.settings.enableWebSearch`; Agent Session
 * persists it through the parent Agent's `disabledTools`. Provider selection for
 * Chat happens server-side at tool execute time — see `WebSearchTool.ts`'s
 * `pickFirstUsableProvider`.
 */
const webSearchTool = defineTool({
  key: 'web_search',
  label: (t) => t('chat.input.web_search.label'),

  visibleInScopes: [TopicType.Chat, TopicType.Session],

  composer: {
    runtime: ({ context }) => <WebSearchRuntime context={context} />
  }
})

export default webSearchTool

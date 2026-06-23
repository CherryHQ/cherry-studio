import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'

import { WebSearchToolRuntime } from '../components/WebSearchButton'

/**
 * Web Search Tool
 *
 * Toggle that flips `assistant.settings.enableWebSearch`. Provider selection
 * happens server-side at tool execute time — see `WebSearchTool.ts`'s
 * `pickFirstUsableProvider`. The previous quick-panel picker has been
 * retired now that there's no per-assistant provider id to set.
 */
const webSearchTool = defineTool({
  key: 'web_search',
  label: (t) => t('chat.input.web_search.label'),

  visibleInScopes: [TopicType.Chat],

  composer: {
    runtime: ({ context }) => <WebSearchToolRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
  }
})

registerTool(webSearchTool)

export default webSearchTool

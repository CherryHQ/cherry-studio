import { defineTool, TopicType } from '@renderer/components/composer/tools/types'

import { UrlContextToolRuntime } from '../components/UrlContextButton'

/**
 * URL Context Tool
 *
 * Toggle that flips `assistant.settings.enableUrlContext`. Enables the
 * provider-native URL-context tool (Gemini URL context / Anthropic web_fetch),
 * which only fires for providers that declare a `url-context` server-tool entry
 * serving a Gemini/Anthropic-family model — see `resolveCapabilities`.
 */
const urlContextTool = defineTool({
  key: 'url_context',
  label: (t) => t('chat.input.url_context'),

  visibleInScopes: [TopicType.Chat],

  composer: {
    runtime: ({ context }) => <UrlContextToolRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
  }
})

export default urlContextTool

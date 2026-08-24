import { defineTool } from '@renderer/components/composer/tools/types'

import { WebSearchToolRuntime } from '../components/WebSearchButton'
import { WEB_SEARCH_TOOLBAR_MANIFEST } from '../toolbarManifests'

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
  label: WEB_SEARCH_TOOLBAR_MANIFEST.label,

  visibleInScopes: WEB_SEARCH_TOOLBAR_MANIFEST.visibleInScopes,

  composer: {
    runtime: ({ context }) => <WebSearchToolRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
  }
})

export default webSearchTool

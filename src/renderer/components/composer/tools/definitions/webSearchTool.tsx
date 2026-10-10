import { defineTool } from '@renderer/components/composer/tools/types'

import { WebSearchToolRuntime } from '../components/WebSearchButton'
import { WEB_SEARCH_TOOLBAR_MANIFEST } from '../toolbarManifests'

/** Web-tool toggle and per-assistant provider choices registered by the composer runtime. */
const webSearchTool = defineTool({
  key: 'web_search',
  label: WEB_SEARCH_TOOLBAR_MANIFEST.label,

  visibleInScopes: WEB_SEARCH_TOOLBAR_MANIFEST.visibleInScopes,

  composer: {
    runtime: ({ context }) => <WebSearchToolRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
  }
})

export default webSearchTool

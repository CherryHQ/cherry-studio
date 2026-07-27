import { QuickPhrasesToolRuntime } from '@renderer/components/composer/tools/components/QuickPhrasesButton'
import { QUICK_PHRASES_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool } from '@renderer/components/composer/tools/types'

const quickPhrasesTool = defineTool({
  key: 'quick_phrases',
  label: QUICK_PHRASES_TOOLBAR_MANIFEST.label,

  visibleInScopes: QUICK_PHRASES_TOOLBAR_MANIFEST.visibleInScopes,

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    toolbar: QUICK_PHRASES_TOOLBAR_MANIFEST.toolbar,
    runtime: ({ context }) => {
      const { actions, launcher } = context

      return <QuickPhrasesToolRuntime launcher={launcher} setInputValue={actions.onTextChange} />
    }
  }
})

export default quickPhrasesTool

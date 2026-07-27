import { ThinkingToolRuntime } from '@renderer/components/composer/tools/components/ThinkingButton'
import { THINKING_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool } from '@renderer/components/composer/tools/types'

const thinkingTool = defineTool({
  key: 'thinking',
  label: THINKING_TOOLBAR_MANIFEST.label,
  visibleInScopes: THINKING_TOOLBAR_MANIFEST.visibleInScopes,
  composer: {
    toolbar: THINKING_TOOLBAR_MANIFEST.toolbar,
    runtime: ({ context: { assistant, model, launcher, reasoning } }) => (
      <ThinkingToolRuntime
        launcher={launcher}
        model={model}
        assistant={assistant}
        reasoningEffort={reasoning?.effort}
        onReasoningEffortChange={reasoning?.onEffortChange}
      />
    )
  }
})

export default thinkingTool

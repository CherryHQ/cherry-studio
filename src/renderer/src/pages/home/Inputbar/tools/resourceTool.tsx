import { useSharedCache } from '@renderer/data/hooks/useCache'
import { defineTool, registerTool, type ToolContext, TopicType } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'
import { useMemo } from 'react'

import ResourceButton from './components/ResourceButton'
import ResourceQuickPanelManager from './components/ResourceQuickPanelManager'

/**
 * Resolve the directories the resource picker should search.
 *
 * - Agent Session: `session.accessiblePaths` (multi, defined on the agent).
 * - Chat topic: a single-element array of the topic's workspaceRoot, if any.
 *   The override comes from the same shared-cache slot that
 *   `workspaceRootTool` writes through, so picking a folder there shows
 *   up here immediately without an SWR refresh.
 */
function useResolvedAccessiblePaths(context: ToolContext): string[] {
  const [override] = useSharedCache(`topic.workspace_root_override.${context.topic?.id ?? '_none'}` as const)
  const sessionPaths = context.session?.accessiblePaths
  const topicRoot = override !== null ? override.root : (context.topic?.workspaceRoot ?? null)
  return useMemo(() => {
    if (context.scope === TopicType.Session) return sessionPaths ?? []
    return topicRoot ? [topicRoot] : []
  }, [context.scope, sessionPaths, topicRoot])
}

/**
 * Resource Tool
 *
 * `@`-style file picker. Visible in:
 *   - Agent Session — searches `session.accessiblePaths`
 *   - Chat topic    — searches the topic's bound `workspaceRoot`
 *
 * File listing is fff-backed (`window.api.file.findPath`), shared with
 * the AI's `fs__find` tool. Skill picker still uses `useInstalledSkills`.
 */
const resourceTool = defineTool({
  key: 'resource_panel',
  label: (t) => t('chat.input.resource_panel.title'),
  visibleInScopes: [TopicType.Session, TopicType.Chat],

  dependencies: {
    state: [] as const,
    actions: ['onTextChange'] as const
  },

  render: function ResourceToolRender(context) {
    const { quickPanel, quickPanelController, actions } = context
    const { onTextChange } = actions

    const accessiblePaths = useResolvedAccessiblePaths(context)

    if (accessiblePaths.length === 0) {
      return null
    }

    return (
      <ResourceButton
        quickPanel={quickPanel}
        quickPanelController={quickPanelController}
        accessiblePaths={accessiblePaths}
        setText={onTextChange as React.Dispatch<React.SetStateAction<string>>}
      />
    )
  },

  quickPanelManager: ResourceQuickPanelManager
})

registerTool(resourceTool)

export default resourceTool

import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import ActivityDirectoryButton from './components/ActivityDirectoryButton'
import ActivityDirectoryQuickPanelManager from './components/ActivityDirectoryQuickPanelManager'

/**
 * Activity Directory Tool
 *
 * Allows users to search and select files from the agent's accessible directories.
 * Uses @ trigger (same symbol as MentionModels, but different scope).
 * Only visible in Agent Session (TopicType.Session).
 */
const activityDirectoryTool = defineTool({
  key: 'activity_directory',
  label: (t) => t('chat.input.activity_directory.title'),
  visibleInScopes: [TopicType.Session],

  dependencies: {
    state: [] as const,
    actions: ['onTextChange'] as const
  },

  render: function ActivityDirectoryToolRender(context) {
    const { quickPanel, quickPanelController, actions, session } = context
    const { onTextChange } = actions

    // Get accessible paths from session data
    const accessiblePaths = session?.accessiblePaths ?? []

    // Only render if we have accessible paths
    if (accessiblePaths.length === 0) {
      return null
    }

    return (
      <ActivityDirectoryButton
        quickPanel={quickPanel}
        quickPanelController={quickPanelController}
        accessiblePaths={accessiblePaths}
        setText={onTextChange as React.Dispatch<React.SetStateAction<string>>}
      />
    )
  },

  quickPanelManager: ActivityDirectoryQuickPanelManager
})

registerTool(activityDirectoryTool)

export default activityDirectoryTool

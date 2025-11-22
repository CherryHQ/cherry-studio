import type { ToolActionKey, ToolRenderContext, ToolStateKey } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import { useActivityDirectoryPanel } from './useActivityDirectoryPanel'

interface ManagerProps {
  context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
}

const ActivityDirectoryQuickPanelManager = ({ context }: ManagerProps) => {
  const {
    quickPanel,
    quickPanelController,
    actions: { onTextChange },
    session
  } = context

  // Get accessible paths and sub-agents from session data
  const accessiblePaths = session?.accessiblePaths ?? []
  const subAgents = session?.subAgents ?? []

  // Always call hooks unconditionally (React rules)
  useActivityDirectoryPanel(
    {
      quickPanel,
      quickPanelController,
      accessiblePaths,
      subAgents,
      setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
    },
    'manager'
  )

  return null
}

export default ActivityDirectoryQuickPanelManager

import type { ToolActionKey, ToolRenderContext, ToolStateKey } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import { useResourcePanel } from './useResourcePanel'

interface ManagerProps {
  context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
}

const ResourceQuickPanelManager = ({ context }: ManagerProps) => {
  const {
    quickPanel,
    quickPanelController,
    actions: { onTextChange },
    session
  } = context

  // Get accessible paths from session data
  const accessiblePaths = session?.accessiblePaths ?? []

  // Always call hooks unconditionally (React rules)
  useResourcePanel(
    {
      quickPanel,
      quickPanelController,
      accessiblePaths,
      agentId: session?.agentId,
      setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
    },
    'manager'
  )

  return null
}

export default ResourceQuickPanelManager

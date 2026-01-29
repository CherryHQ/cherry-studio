import { useInstalledPlugins } from '@renderer/hooks/usePlugins'
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

  // Get accessible paths and agentId from session data
  const accessiblePaths = session?.accessiblePaths ?? []
  const agentId = session?.agentId

  // Fetch installed plugins (agents and skills) from .claude directory
  const { plugins, loading: pluginsLoading } = useInstalledPlugins(agentId)

  // Always call hooks unconditionally (React rules)
  useResourcePanel(
    {
      quickPanel,
      quickPanelController,
      accessiblePaths,
      plugins,
      pluginsLoading,
      setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
    },
    'manager'
  )

  return null
}

export default ResourceQuickPanelManager

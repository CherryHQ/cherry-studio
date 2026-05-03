import { useSharedCache } from '@renderer/data/hooks/useCache'
import type { ToolActionKey, ToolRenderContext, ToolStateKey } from '@renderer/pages/home/Inputbar/types'
import { TopicType } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'
import { useMemo } from 'react'

import { useResourcePanel } from './useResourcePanel'

interface ManagerProps {
  context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
}

const ResourceQuickPanelManager = ({ context }: ManagerProps) => {
  const {
    quickPanel,
    quickPanelController,
    actions: { onTextChange },
    scope,
    session,
    topic
  } = context

  // Mirror the resolution rules from `resourceTool.tsx` so the trigger
  // ('@' / '/') registered by this manager respects the same scope source
  // as the button. Session → multi accessiblePaths; Chat → single topic
  // workspaceRoot (with the workspace_root_override shared-cache slot
  // taking precedence so picker freshness matches the picker tool).
  //
  // Memoized: a fresh array on every render cascades through
  // getRelativePath → createFileItems → categorizedItems, and the
  // manager's updateList effect would loop.
  const [override] = useSharedCache(`topic.workspace_root_override.${topic?.id ?? '_none'}` as const)
  const sessionPaths = session?.accessiblePaths
  const topicRoot = override !== null ? override.root : (topic?.workspaceRoot ?? null)
  const accessiblePaths = useMemo(() => {
    if (scope === TopicType.Session) return sessionPaths ?? []
    return topicRoot ? [topicRoot] : []
  }, [scope, sessionPaths, topicRoot])

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

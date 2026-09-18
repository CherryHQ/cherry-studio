import { CodeXml, Eye, SquarePen, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import type { ViewMode } from '@renderer/components/CodeBlockView/types'

interface UseViewSourceToolProps {
  canEdit: boolean
  hasSpecialView: boolean
  isStreaming: boolean
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useViewSourceTool = ({
  canEdit,
  hasSpecialView,
  isStreaming,
  viewMode,
  onViewModeChange,
  setTools
}: UseViewSourceToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  useEffect(() => {
    if (viewMode === 'split') return

    if (canEdit && !isStreaming) {
      const leaveEdit = hasSpecialView
        ? { mode: 'special' as const, icon: <Eye className="tool-icon" />, tooltip: t('preview.label') }
        : { mode: 'source' as const, icon: <X className="tool-icon" />, tooltip: t('common.cancel') }
      const isEditing = viewMode === 'edit'
      registerTool({
        ...TOOL_SPECS.edit,
        icon: isEditing ? leaveEdit.icon : <SquarePen className="tool-icon" />,
        tooltip: isEditing ? leaveEdit.tooltip : t('code_block.edit.label'),
        onClick: () => onViewModeChange(isEditing ? leaveEdit.mode : 'edit')
      })
      return () => removeTool(TOOL_SPECS.edit.id)
    }

    if (!hasSpecialView) return

    const showingSource = viewMode === 'source'
    registerTool({
      ...TOOL_SPECS['view-source'],
      icon: showingSource ? <Eye className="tool-icon" /> : <CodeXml className="tool-icon" />,
      tooltip: showingSource ? t('preview.label') : t('preview.source'),
      onClick: () => onViewModeChange(showingSource ? 'special' : 'source')
    })
    return () => removeTool(TOOL_SPECS['view-source'].id)
  }, [canEdit, hasSpecialView, isStreaming, onViewModeChange, registerTool, removeTool, t, viewMode])
}

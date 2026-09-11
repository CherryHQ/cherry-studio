import { CodeXml, Eye, SquarePen } from 'lucide-react'
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

    const canEnterEdit = canEdit && !isStreaming
    if (canEnterEdit && (hasSpecialView || viewMode === 'source')) {
      registerTool({
        ...TOOL_SPECS.edit,
        icon: viewMode === 'edit' ? <Eye className="tool-icon" /> : <SquarePen className="tool-icon" />,
        tooltip: viewMode === 'edit' ? t('preview.label') : t('code_block.edit.label'),
        onClick: () => onViewModeChange(viewMode === 'edit' ? 'special' : 'edit')
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

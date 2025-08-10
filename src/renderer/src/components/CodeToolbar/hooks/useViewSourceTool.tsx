import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { ViewMode } from '@renderer/components/CodeBlockView/types'
import { CodeXml, Eye, SquarePen } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseViewSourceToolProps {
  enabled: boolean
  editable: boolean
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useViewSourceTool = ({
  enabled,
  editable,
  viewMode,
  onViewModeChange,
  setTools
}: UseViewSourceToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  const handleToggleViewMode = useCallback(() => {
    const newMode = viewMode === 'source' ? 'special' : 'source'
    onViewModeChange?.(newMode)
  }, [viewMode, onViewModeChange])

  useEffect(() => {
    if (!enabled || viewMode === 'split') return

    const toolSpec = editable ? TOOL_SPECS.edit : TOOL_SPECS['view-source']

    if (editable) {
      registerTool({
        ...toolSpec,
        icon: viewMode === 'source' ? <Eye className="tool-icon" /> : <SquarePen className="tool-icon" />,
        tooltip: viewMode === 'source' ? t('preview.label') : t('code_block.edit.label'),
        onClick: handleToggleViewMode
      })
    } else {
      registerTool({
        ...toolSpec,
        icon: viewMode === 'source' ? <Eye className="tool-icon" /> : <CodeXml className="tool-icon" />,
        tooltip: viewMode === 'source' ? t('preview.label') : t('preview.source'),
        onClick: handleToggleViewMode
      })
    }

    return () => removeTool(toolSpec.id)
  }, [enabled, editable, viewMode, registerTool, removeTool, t, handleToggleViewMode])
}

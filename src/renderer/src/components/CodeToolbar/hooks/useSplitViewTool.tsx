import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { ViewMode } from '@renderer/components/CodeBlockView/types'
import { Square, SquareSplitHorizontal } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseSplitViewToolProps {
  enabled: boolean
  viewMode: ViewMode
  onToggleSplitView: () => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useSplitViewTool = ({ enabled, viewMode, onToggleSplitView, setTools }: UseSplitViewToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  const handleToggleSplitView = useCallback(() => {
    onToggleSplitView?.()
  }, [onToggleSplitView])

  useEffect(() => {
    if (!enabled) return

    registerTool({
      ...TOOL_SPECS['split-view'],
      icon: viewMode === 'split' ? <Square className="tool-icon" /> : <SquareSplitHorizontal className="tool-icon" />,
      tooltip: viewMode === 'split' ? t('code_block.split.restore') : t('code_block.split.label'),
      onClick: handleToggleSplitView
    })

    return () => removeTool(TOOL_SPECS['split-view'].id)
  }, [enabled, viewMode, registerTool, removeTool, t, handleToggleSplitView])
}

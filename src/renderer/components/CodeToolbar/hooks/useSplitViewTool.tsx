import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { Square, SquareSplitHorizontal } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseSplitViewToolProps {
  enabled: boolean
  viewMode: ViewMode
  onToggleSplitView: () => void
}

export const useSplitViewTool = ({ enabled, viewMode, onToggleSplitView }: UseSplitViewToolProps) => {
  const { t } = useTranslation()

  const handleToggleSplitView = useCallback(() => {
    onToggleSplitView?.()
  }, [onToggleSplitView])

  return useMemo<ActionTool | null>(() => {
    if (!enabled) {
      return null
    }

    return {
      ...TOOL_SPECS['split-view'],
      icon: viewMode === 'split' ? <Square className="tool-icon" /> : <SquareSplitHorizontal className="tool-icon" />,
      tooltip: viewMode === 'split' ? t('code_block.split.restore') : t('code_block.split.label'),
      onClick: handleToggleSplitView
    }
  }, [enabled, viewMode, handleToggleSplitView, t])
}

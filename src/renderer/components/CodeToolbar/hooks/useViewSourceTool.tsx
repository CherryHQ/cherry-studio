import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { CodeXml, Eye, SquarePen } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseViewSourceToolProps {
  enabled: boolean
  editable: boolean
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}

export const useViewSourceTool = ({ enabled, editable, viewMode, onViewModeChange }: UseViewSourceToolProps) => {
  const { t } = useTranslation()

  const handleToggleViewMode = useCallback(() => {
    const newMode = viewMode === 'source' ? 'special' : 'source'
    onViewModeChange?.(newMode)
  }, [viewMode, onViewModeChange])

  return useMemo<ActionTool | null>(() => {
    if (!enabled || viewMode === 'split') {
      return null
    }

    const toolSpec = editable ? TOOL_SPECS.edit : TOOL_SPECS['view-source']

    if (editable) {
      return {
        ...toolSpec,
        icon: viewMode === 'source' ? <Eye className="tool-icon" /> : <SquarePen className="tool-icon" />,
        tooltip: viewMode === 'source' ? t('preview.label') : t('code_block.edit.label'),
        onClick: handleToggleViewMode
      }
    }

    return {
      ...toolSpec,
      icon: viewMode === 'source' ? <Eye className="tool-icon" /> : <CodeXml className="tool-icon" />,
      tooltip: viewMode === 'source' ? t('preview.label') : t('preview.source'),
      onClick: handleToggleViewMode
    }
  }, [enabled, editable, viewMode, handleToggleViewMode, t])
}

import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseExpandToolProps {
  enabled?: boolean
  expanded?: boolean
  expandable?: boolean
  toggle: () => void
}

export const useExpandTool = ({ enabled, expanded, expandable, toggle }: UseExpandToolProps) => {
  const { t } = useTranslation()

  const handleToggle = useCallback(() => {
    toggle?.()
  }, [toggle])

  return useMemo<ActionTool | null>(() => {
    if (!enabled) {
      return null
    }

    return {
      ...TOOL_SPECS.expand,
      icon: expanded ? <ChevronsDownUp className="tool-icon" /> : <ChevronsUpDown className="tool-icon" />,
      tooltip: expanded ? t('code_block.collapse') : t('code_block.expand'),
      visible: () => expandable ?? false,
      onClick: handleToggle
    }
  }, [enabled, expandable, expanded, handleToggle, t])
}

import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseExpandToolProps {
  enabled?: boolean
  expanded?: boolean
  expandable?: boolean
  toggle: () => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useExpandTool = ({ enabled, expanded, expandable, toggle, setTools }: UseExpandToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  const handleToggle = useCallback(() => {
    toggle?.()
  }, [toggle])

  useEffect(() => {
    if (enabled) {
      registerTool({
        ...TOOL_SPECS.expand,
        icon: expanded ? <ChevronsDownUp className="tool-icon" /> : <ChevronsUpDown className="tool-icon" />,
        tooltip: expanded ? t('code_block.collapse') : t('code_block.expand'),
        visible: () => expandable ?? false,
        onClick: handleToggle
      })
    }

    return () => removeTool(TOOL_SPECS.expand.id)
  }, [enabled, expandable, expanded, handleToggle, registerTool, removeTool, t])
}

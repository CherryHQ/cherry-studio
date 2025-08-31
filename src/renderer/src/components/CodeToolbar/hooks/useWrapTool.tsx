import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { Text as UnWrapIcon, WrapText as WrapIcon } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseWrapToolProps {
  enabled?: boolean
  wrapped?: boolean
  wrappable?: boolean
  toggle: () => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useWrapTool = ({ enabled, wrapped, wrappable, toggle, setTools }: UseWrapToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  const handleToggle = useCallback(() => {
    toggle?.()
  }, [toggle])

  useEffect(() => {
    if (enabled) {
      registerTool({
        ...TOOL_SPECS.wrap,
        icon: wrapped ? <UnWrapIcon className="tool-icon" /> : <WrapIcon className="tool-icon" />,
        tooltip: wrapped ? t('code_block.wrap.off') : t('code_block.wrap.on'),
        visible: () => wrappable ?? false,
        onClick: handleToggle
      })
    }

    return () => removeTool(TOOL_SPECS.wrap.id)
  }, [enabled, handleToggle, registerTool, removeTool, t, wrapped, wrappable])
}

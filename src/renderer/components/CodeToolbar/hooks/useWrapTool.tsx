import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import { Text as UnWrapIcon, WrapText as WrapIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseWrapToolProps {
  enabled?: boolean
  wrapped?: boolean
  wrappable?: boolean
  toggle: () => void
}

export const useWrapTool = ({ enabled, wrapped, wrappable, toggle }: UseWrapToolProps) => {
  const { t } = useTranslation()

  const handleToggle = useCallback(() => {
    toggle?.()
  }, [toggle])

  return useMemo<ActionTool | null>(() => {
    if (!enabled) {
      return null
    }

    return {
      ...TOOL_SPECS.wrap,
      icon: wrapped ? <UnWrapIcon className="tool-icon" /> : <WrapIcon className="tool-icon" />,
      tooltip: wrapped ? t('code_block.wrap.off') : t('code_block.wrap.on'),
      visible: () => wrappable ?? false,
      onClick: handleToggle
    }
  }, [enabled, handleToggle, t, wrapped, wrappable])
}

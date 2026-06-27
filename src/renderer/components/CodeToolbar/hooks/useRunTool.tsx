import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import { LoadingIcon } from '@renderer/components/Icons'
import { CirclePlay } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseRunToolProps {
  enabled: boolean
  isRunning: boolean
  onRun: () => void
}

export const useRunTool = ({ enabled, isRunning, onRun }: UseRunToolProps) => {
  const { t } = useTranslation()

  return useMemo<ActionTool | null>(() => {
    if (!enabled) {
      return null
    }

    return {
      ...TOOL_SPECS.run,
      icon: isRunning ? <LoadingIcon className="tool-icon" /> : <CirclePlay className="tool-icon" />,
      tooltip: t('code_block.run'),
      onClick: () => !isRunning && onRun?.()
    }
  }, [enabled, isRunning, onRun, t])
}

import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { LoadingIcon } from '@renderer/components/Icons'
import { CirclePlay } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseRunToolProps {
  enabled: boolean
  isRunning: boolean
  onRun: () => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useRunTool = ({ enabled, isRunning, onRun, setTools }: UseRunToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  useEffect(() => {
    if (!enabled) return

    registerTool({
      ...TOOL_SPECS.run,
      icon: isRunning ? <LoadingIcon className="tool-icon" /> : <CirclePlay className="tool-icon" />,
      tooltip: t('code_block.run'),
      onClick: () => !isRunning && onRun?.()
    })

    return () => removeTool(TOOL_SPECS.run.id)
  }, [enabled, isRunning, onRun, registerTool, removeTool, t])
}

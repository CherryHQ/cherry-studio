import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import { type CodeEditorHandles } from '@renderer/components/CodeEditor'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { Check, SaveIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseSaveToolProps {
  enabled?: boolean
  sourceViewRef: React.RefObject<CodeEditorHandles | null>
}

export const useSaveTool = ({ enabled, sourceViewRef }: UseSaveToolProps) => {
  const [saved, setSavedTemporarily] = useTemporaryValue(false)
  const { t } = useTranslation()

  const handleSave = useCallback(() => {
    sourceViewRef.current?.save?.()
    setSavedTemporarily(true)
  }, [sourceViewRef, setSavedTemporarily])

  return useMemo<ActionTool | null>(() => {
    if (!enabled) {
      return null
    }

    return {
      ...TOOL_SPECS.save,
      icon: saved ? (
        <Check className="tool-icon" color="var(--color-status-success)" />
      ) : (
        <SaveIcon className="tool-icon" />
      ),
      tooltip: t('code_block.edit.save.label'),
      onClick: handleSave
    }
  }, [enabled, handleSave, saved, t])
}

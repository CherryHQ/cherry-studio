import { ActionIconButton } from '@renderer/components/Buttons'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { Tooltip } from 'antd'
import { Code } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export interface CodeExecutionButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<CodeExecutionButtonRef | null>
  assistantId: string
}

const UrlContextButton: FC<Props> = ({ assistantId }) => {
  const { t } = useTranslation()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()

  const codeExecutionNewState = !assistant.enableCodeExecution

  const handleToggle = useCallback(() => {
    setTimeoutTimer(
      'handleToggle',
      () => {
        const update = { ...assistant }
        if (
          assistant.mcpServers &&
          assistant.mcpServers.length > 0 &&
          codeExecutionNewState === true &&
          isToolUseModeFunction(assistant)
        ) {
          update.enableCodeExecution = false
          window.toast.warning(t('chat.mcp.warning.gemini_code_execution'))
        } else {
          update.enableCodeExecution = codeExecutionNewState
        }
        updateAssistant(update)
      },
      100
    )
  }, [setTimeoutTimer, assistant, codeExecutionNewState, updateAssistant, t])

  return (
    <Tooltip placement="top" title={t('chat.input.code_execution')} arrow>
      <ActionIconButton onClick={handleToggle} active={assistant.enableCodeExecution}>
        <Code size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(UrlContextButton)

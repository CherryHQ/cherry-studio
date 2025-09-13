import { ActionIconButton } from '@renderer/components/Buttons'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { Tooltip } from 'antd'
import { Link } from 'lucide-react'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export interface UrlContextButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<UrlContextButtonRef | null>
  assistantId: string
}

const UrlContextButton: FC<Props> = ({ assistantId }) => {
  const { t } = useTranslation()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()

  const urlContentNewState = !assistant.enableUrlContext

  const handleToggle = useCallback(() => {
    setTimeoutTimer(
      'handleToggle',
      () => {
        const update = { ...assistant }
        if (
          assistant.mcpServers &&
          assistant.mcpServers.length > 0 &&
          urlContentNewState === true &&
          isToolUseModeFunction(assistant)
        ) {
          update.enableUrlContext = false
          window.toast.warning(t('chat.mcp.warning.url_context'))
        } else {
          update.enableUrlContext = urlContentNewState
        }
        updateAssistant(update)
      },
      100
    )
  }, [setTimeoutTimer, assistant, urlContentNewState, updateAssistant, t])

  return (
    <Tooltip placement="top" title={t('chat.input.url_context')} arrow>
      <ActionIconButton onClick={handleToggle} active={assistant.enableUrlContext}>
        <Link size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(UrlContextButton)

import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import { Assistant } from '@renderer/types'
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
  assistant: Assistant
  ToolbarButton: any
}

const UrlContextButton: FC<Props> = ({ assistant, ToolbarButton }) => {
  const { t } = useTranslation()
  const { updateAssistant } = useAssistant(assistant.id)
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
      <ToolbarButton type="text" onClick={handleToggle}>
        <Link
          size={18}
          style={{
            color: assistant.enableUrlContext ? 'var(--color-primary)' : 'var(--color-icon)'
          }}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(UrlContextButton)

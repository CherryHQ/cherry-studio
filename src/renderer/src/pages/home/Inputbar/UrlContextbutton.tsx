import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
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

  const urlContentNewState = !assistant.enableUrlContext

  const handleToggle = useCallback(() => {
    setTimeout(() => {
      updateAssistant({ ...assistant, enableUrlContext: urlContentNewState })
    }, 100)
  }, [assistant, urlContentNewState, updateAssistant])

  return (
    <Tooltip placement="top" title={t('chat.input.url_context')} arrow>
      <ToolbarButton type="text" onClick={handleToggle}>
        <Link
          size={18}
          style={{
            color: assistant.enableUrlContext ? 'var(--color-link)' : 'var(--color-icon)'
          }}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(UrlContextButton)

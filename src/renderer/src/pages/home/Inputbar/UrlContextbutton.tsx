import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
import { Tooltip } from 'antd'
import { Link } from 'lucide-react'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  ToolbarButton: any
}

const UrlContextButton: FC<Props> = ({ assistant, ToolbarButton }) => {
  const { t } = useTranslation()
  const { updateAssistant } = useAssistant(assistant.id)

  const isUrlContextOn = assistant.enableUrlContext === true

  const handleToggle = useCallback(() => {
    setTimeout(() => {
      updateAssistant({ ...assistant, enableUrlContext: !isUrlContextOn })
    }, 100)
  }, [assistant, isUrlContextOn, updateAssistant])

  return (
    <Tooltip placement="top" title={t('chat.input.url_context')} arrow>
      <ToolbarButton type="text" onClick={handleToggle}>
        <Link
          size={18}
          style={{
            color: isUrlContextOn ? 'var(--color-link)' : 'var(--color-icon)'
          }}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(UrlContextButton)

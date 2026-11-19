import type { ComponentType } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'

const BlockErrorFallback: ComponentType<FallbackProps> = ({ error }) => {
  const { t } = useTranslation()
  const message = t('error.render.block', { defaultValue: 'This content block failed to render' })

  return (
    <ErrorNotice
      variant="inline"
      title={message}
      detail={<ErrorDetailAction error={error} message={message} source="chat.block" operation="block.render" />}
    />
  )
}

export default BlockErrorFallback

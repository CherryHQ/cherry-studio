import type { ComponentType } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { isProd } from '@renderer/utils/platform'

const BlockErrorFallback: ComponentType<FallbackProps> = ({ error }) => {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-dashed border-error-border bg-error-subtle px-3 py-2 text-xs text-error-subtle-foreground">
      <div>{t('error.render.block', { defaultValue: 'This content block failed to render' })}</div>
      {!isProd && error && <div className="mt-1 font-mono break-all">{error.message}</div>}
    </div>
  )
}

export default BlockErrorFallback

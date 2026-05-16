import { isProd } from '@renderer/config/constant'
import type { ComponentType } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const BlockErrorFallback: ComponentType<FallbackProps> = ({ error }) => {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-error-border border-dashed bg-error-bg px-3 py-2 text-xs">
      <div className="text-error-text">
        {t('error.render.block', { defaultValue: 'This content block failed to render' })}
      </div>
      {!isProd && error && <div className="mt-1 break-all font-mono text-foreground-muted">{error.message}</div>}
    </div>
  )
}

export default BlockErrorFallback

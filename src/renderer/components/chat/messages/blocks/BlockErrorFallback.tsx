import { isProd } from '@renderer/utils/platform'
import type { ComponentType } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const BlockErrorFallback: ComponentType<FallbackProps> = ({ error }) => {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-error-border border-dashed bg-error-subtle px-3 py-2 text-error-subtle-foreground text-xs">
      <div>{t('error.render.block', { defaultValue: 'This content block failed to render' })}</div>
      {!isProd && error && <div className="mt-1 break-all font-mono">{error.message}</div>}
    </div>
  )
}

export default BlockErrorFallback

import { isProd } from '@renderer/config/constant'
import type { ComponentType } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const BlockErrorFallback: ComponentType<FallbackProps> = ({ error }) => {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-(--color-status-warning,#faad14) border-dashed bg-[color-mix(in_srgb,var(--color-status-warning)_4%,transparent)] px-3 py-2 text-xs">
      <div className="text-(--color-status-warning,#faad14)">
        {t('error.render.block', { defaultValue: 'This content block failed to render' })}
      </div>
      {!isProd && error && <div className="mt-1 break-all font-mono text-(--color-text-3)">{error.message}</div>}
    </div>
  )
}

export default BlockErrorFallback

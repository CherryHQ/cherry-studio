import { MessageProcessor } from '@prometheus-ags/a2ui-core/v0_9'
import { UarSurface, uarBasicCatalog, type UarLocale } from '@prometheus-ags/a2ui-uar'

import '@prometheus-ags/a2ui-uar/styles.css'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '@renderer/hooks/useTheme'
import type { UarPresentationTemplate } from '@shared/types/prometheusIntegration'

export function UarPresentationPreview({ template }: { template: UarPresentationTemplate }) {
  const { i18n, t } = useTranslation()
  const { theme } = useTheme()
  const locale = (
    ['es', 'ja', 'zh'].includes(i18n.language.split('-')[0]) ? i18n.language.split('-')[0] : 'en'
  ) as UarLocale
  const result = useMemo(() => {
    try {
      const processor = new MessageProcessor([uarBasicCatalog], undefined, { version: 'v0.9.1' })
      const surfaceId = 'boss-presentation-preview'
      processor.processMessages([
        {
          version: template.version as 'v0.9.1',
          createSurface: { surfaceId, catalogId: template.catalog_id }
        },
        {
          version: template.version as 'v0.9.1',
          updateComponents: { surfaceId, components: template.components }
        },
        ...Object.entries(template.default_data).map(([key, value]) => ({
          version: template.version as 'v0.9.1',
          updateDataModel: { surfaceId, path: `/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, value }
        }))
      ])
      const surface = processor.model.getSurface(surfaceId)
      return surface ? { surface } : { error: 'Preview surface was not created' }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [template])

  if (!result.surface) {
    return (
      <div className="rounded-lg border border-error-border bg-error-subtle p-3 text-sm text-error" role="alert">
        {t('settings.prometheus.integration.uarAdmin.presentations.previewFailed')}: {result.error}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <UarSurface
        surface={result.surface}
        theme={theme === 'dark' ? 'dark' : 'light'}
        locale={locale}
        transitionKey={JSON.stringify(template)}
      />
    </div>
  )
}

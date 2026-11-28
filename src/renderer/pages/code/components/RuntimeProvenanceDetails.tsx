import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeProvenance } from '@shared/types/runtimeProvenance'

const SOURCE_LABEL_KEYS: Record<RuntimeProvenance['binarySource'], string> = {
  mise: 'code.runtime_provenance.source.managed',
  bundled: 'code.runtime_provenance.source.bundled',
  system: 'code.runtime_provenance.source.system',
  none: 'code.runtime_provenance.source.none'
}

/** Runtime facts for tools with a Cherry-owned config home; rendered when installed. */
export const RuntimeProvenanceDetails: FC<{ provenance: RuntimeProvenance }> = ({ provenance }) => {
  const { t } = useTranslation()
  return (
    <dl className="mt-4 space-y-1.5 border-border-subtle border-t pt-3 text-xs">
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">{t('code.runtime_provenance.source.label')}</dt>
        <dd className="text-foreground">
          {t(SOURCE_LABEL_KEYS[provenance.binarySource])}
          {provenance.version && <span className="ml-1.5 font-mono text-muted-foreground">v{provenance.version}</span>}
        </dd>
      </div>
      {provenance.executablePath && (
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">{t('code.runtime_provenance.executable')}</dt>
          <dd className="min-w-0 break-all font-mono text-foreground">{provenance.executablePath}</dd>
        </div>
      )}
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">{t('code.runtime_provenance.config_home')}</dt>
        <dd className="min-w-0 break-all font-mono text-foreground">{provenance.configHome}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">{t('code.runtime_provenance.plugin_roots')}</dt>
        <dd className="min-w-0 space-y-0.5">
          {provenance.pluginRoots === null && <span className="text-muted-foreground">{t('common.unknown')}</span>}
          {provenance.pluginRoots?.map((root) => (
            <div key={root} className="break-all font-mono text-foreground">
              {root}
            </div>
          ))}
        </dd>
      </div>
      {provenance.reloadRequirement === 'restart_session' && (
        <p className="text-muted-foreground">{t('code.runtime_provenance.reload_hint')}</p>
      )}
    </dl>
  )
}

import { Button } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingSubtitle
} from '@renderer/components/SettingsPrimitives'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { IntegrationAction, IntegrationSnapshot } from '@shared/types/prometheusIntegration'

export function UarIntegrationStatus({
  snapshot,
  busy,
  dirty,
  theme,
  text,
  start,
  id
}: {
  snapshot: IntegrationSnapshot
  busy: boolean
  dirty: boolean
  theme: ThemeMode
  text: (key: string) => string
  start: (action: IntegrationAction) => void
  id?: string
}) {
  const describeStorage = (
    backend: 'embedded' | 'remote',
    details: { endpoint?: string; namespace?: string; database?: string }
  ) => {
    if (backend === 'embedded') return text('uarBackendLocal')
    return [
      text('backends.remote'),
      details.endpoint,
      details.namespace && details.database ? `${details.namespace}/${details.database}` : undefined
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const rows = [
    [text('uarProcess'), text(`states.${snapshot.uar.state}`)],
    [text('uarRuntimeVersion'), snapshot.uar.runtimeVersion ?? text('uarUnavailable')],
    [
      text('uarRequestedBackend'),
      describeStorage(snapshot.uar.requestedBackend, snapshot.config.uar)
    ],
    [
      text('uarEffectiveBackend'),
      describeStorage(snapshot.uar.effectiveBackend, snapshot.uar)
    ],
    [text('uarConfigurationState'), text(snapshot.uar.applyRequired ? 'uarApplyRequired' : 'uarApplied')],
    [text('uarSkills'), String(snapshot.inventory?.skills.length ?? 0)],
    [
      text('uarCapabilities'),
      snapshot.uar.capabilities.length ? snapshot.uar.capabilities.join(', ') : text('uarUnavailable')
    ]
  ]

  return (
    <SettingGroup theme={theme} id={id} className="scroll-mt-6">
      <SettingSubtitle>{text('uar')}</SettingSubtitle>
      <SettingDescription>{text('uarDescription')}</SettingDescription>
      <SettingDivider />
      <dl className="divide-y divide-border-subtle">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4">
            <dt className="font-medium">{label}</dt>
            <dd className="min-w-0 break-words text-foreground-secondary">{value}</dd>
          </div>
        ))}
        <div className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4">
          <dt className="font-medium">{text('uarBinary')}</dt>
          <dd className="min-w-0 break-all text-foreground-secondary">
            {snapshot.uar.binary ?? text('uarUnavailable')}
            {snapshot.uar.binaryVersion ? ` · ${snapshot.uar.binaryVersion}` : ''}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => start('uar-check')}>
          {text('actions.uar-check')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || dirty || !snapshot.uar.applyRequired}
          onClick={() => start('uar-apply')}>
          {text('actions.uar-apply')}
        </Button>
        <Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => start('uar-restart')}>
          {text('actions.uar-restart')}
        </Button>
      </div>
      {snapshot.uar.lastApplyError ? (
        <SettingHelpText className="mt-3 text-error" role="alert">
          {text('uarLastApplyError')}: {snapshot.uar.lastApplyError}
        </SettingHelpText>
      ) : (
        <SettingHelpText className="mt-3">{text('uarApplyHelp')}</SettingHelpText>
      )}
    </SettingGroup>
  )
}

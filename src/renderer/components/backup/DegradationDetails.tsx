import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { BackupDegradationCode } from '@shared/ipc/schemas/backup'
import type { OutputFor } from '@shared/ipc/types'

export type BackupDegradation = Extract<
  OutputFor<'backup.prepare_restore'>,
  { status: 'prepared' }
>['preview']['degradations'][number]

/** Written out rather than interpolated, so the keys stay greppable. */
const DEGRADATION_KEYS: Record<BackupDegradationCode, string> = {
  'capability-malformed': 'settings.data.backup_v2.outcome.degradation.capability_malformed',
  'external-file-dropped': 'settings.data.backup_v2.outcome.degradation.external_file_dropped',
  'path-unportable': 'settings.data.backup_v2.outcome.degradation.path_unportable',
  'path-collision': 'settings.data.backup_v2.outcome.degradation.path_collision',
  'resource-unavailable': 'settings.data.backup_v2.outcome.degradation.resource_unavailable',
  'resource-changed': 'settings.data.backup_v2.outcome.degradation.resource_changed',
  'resource-nonportable': 'settings.data.backup_v2.outcome.degradation.resource_nonportable',
  'resource-limit': 'settings.data.backup_v2.outcome.degradation.resource_limit',
  'workspace-disconnected': 'settings.data.backup_v2.outcome.degradation.workspace_disconnected',
  'external-reference': 'settings.data.backup_v2.outcome.degradation.external_reference',
  'dangling-reference': 'settings.data.backup_v2.outcome.degradation.dangling_reference',
  'cyclic-reference': 'settings.data.backup_v2.outcome.degradation.cyclic_reference',
  'unclassified-reference': 'settings.data.backup_v2.outcome.degradation.unclassified_reference',
  'knowledge-index-rebuild': 'settings.data.backup_v2.outcome.degradation.knowledge_index_rebuild',
  unknown: 'settings.data.backup_v2.outcome.degradation.unknown'
}

export function degradationCount(degradations: readonly BackupDegradation[]): number {
  return degradations.reduce((total, degradation) => total + degradation.count, 0)
}

/** What an export or restore reduced, one line per cause plus the sampled paths. */
export const DegradationDetails: FC<{
  degradations: readonly BackupDegradation[]
  consequenceKey?: string
}> = ({ degradations, consequenceKey }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      {consequenceKey && <p>{t(consequenceKey, { count: degradationCount(degradations) })}</p>}
      <ul className="list-disc pl-5">
        {degradations.map((degradation) => (
          <li key={degradation.code}>
            {t(DEGRADATION_KEYS[degradation.code], { count: degradation.count })}
            {degradation.paths?.length ? (
              <ul className="list-[circle] pl-5 text-muted-foreground">
                {degradation.paths.map((path) => (
                  <li key={path} dir="auto" className="break-all [unicode-bidi:isolate]">
                    {path}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

import type { DoctorBasics, DoctorCheckId, DoctorCheckStatus, DoctorReport } from '@shared/types/doctor'
import { projectDoctorReport } from '@shared/types/doctor'

type CopyBasic = 'version' | 'edition' | 'channel' | 'system' | 'osRelease' | 'isPackaged' | 'isPortable'

export interface DoctorCopyLabels {
  readonly heading: string
  readonly basicsHeading: string
  readonly checksHeading: string
  readonly basics: Readonly<Record<CopyBasic, string>>
  readonly title: (id: DoctorCheckId) => string
  readonly status: (status: DoctorCheckStatus) => string
  readonly boolean: (value: boolean) => string
}

function formatBasics(basics: DoctorBasics, labels: DoctorCopyLabels): readonly string[] {
  const lines = [
    `${labels.basics.version}: ${basics.version}`,
    `${labels.basics.edition}: ${basics.edition}`,
    `${labels.basics.channel}: ${basics.channel}`,
    `${labels.basics.system}: ${basics.platform} ${basics.arch}`,
    `${labels.basics.osRelease}: ${basics.osRelease}`,
    `${labels.basics.isPackaged}: ${labels.boolean(basics.isPackaged)}`,
    `${labels.basics.isPortable}: ${labels.boolean(basics.isPortable)}`
  ]

  for (const [name, value] of Object.entries(basics.runtime)) {
    if (value) lines.push(`${name[0].toUpperCase()}${name.slice(1)} ${value}`)
  }
  return lines
}

export function formatDoctorReportForCopy(report: DoctorReport, labels: DoctorCopyLabels): string {
  const publicReport = projectDoctorReport(report, 'copy')
  const lines = [
    labels.heading,
    '',
    labels.basicsHeading,
    ...formatBasics(publicReport.basics, labels),
    '',
    labels.checksHeading
  ]

  for (const result of publicReport.results) {
    lines.push(`${labels.title(result.id)} [${result.id}]: ${labels.status(result.status)}`)
    for (const evidence of result.evidence ?? []) {
      if (evidence.dataClass === 'public') lines.push(`  ${evidence.key}: ${String(evidence.value)}`)
    }
  }

  return lines.join('\n')
}

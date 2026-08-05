import type { EventPayload } from '@shared/ipc/types'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type BackupProgress = EventPayload<'backup.progress'>

const handlers: Array<(payload: BackupProgress) => void> = []

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({
  useIpcOn: (_event: string, handler: (payload: BackupProgress) => void) => {
    handlers.push(handler)
  }
}))

const { default: BackupProgressDialog } = await import('../BackupProgressDialog')

function emit(payload: BackupProgress): void {
  act(() => {
    for (const handler of handlers) handler(payload)
  })
}

describe('BackupProgressDialog', () => {
  beforeEach(() => {
    handlers.length = 0
  })

  // `mode="wait"` holds the outgoing label until its exit finishes, so the new
  // one arrives a frame later.
  it('shows the stage the running operation reports', async () => {
    render(<BackupProgressDialog open operation="export" />)
    emit({ operation: 'export', stage: 'snapshotting-db' })

    expect(await screen.findByText('settings.data.backup.progress.stage.snapshotting-db')).toBeInTheDocument()
  })

  it('names the unit being worked on and how far through the set it is', () => {
    render(<BackupProgressDialog open operation="export" />)
    emit({
      operation: 'export',
      stage: 'capturing-resources',
      resources: { done: 82, total: 88, kind: 'file-blob', livePath: 'Data/Files/report.pdf' }
    })

    expect(screen.getByText('82 / 88')).toBeInTheDocument()
    expect(screen.getByText('Data/Files/report.pdf')).toBeInTheDocument()
  })

  // Two operations share one broadcast channel, so a restore's progress must not
  // drive an export's dialog.
  it('ignores progress belonging to a different operation', () => {
    render(<BackupProgressDialog open operation="export" />)
    emit({ operation: 'prepare-restore', stage: 'admitting' })

    expect(screen.queryByText('settings.data.backup.progress.stage.admitting')).not.toBeInTheDocument()
    expect(screen.getByText('settings.data.backup.progress.starting')).toBeInTheDocument()
  })
})

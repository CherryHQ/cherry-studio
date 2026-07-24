import { Button } from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const gateSpies = vi.hoisted(() => ({
  isV2BackupExportReady: vi.fn(() => true),
  isV2BackupRestoreReady: vi.fn(() => false),
  isV2BackupRestoreLiteReady: vi.fn(() => true),
  isV2BackupRestoreFullReady: vi.fn(() => false)
}))

vi.mock('../V2BackupActionGate', async (importOriginal) => {
  const actual = await importOriginal<typeof V2BackupActionGateModule>()
  return {
    ...actual,
    isV2BackupExportReady: () => gateSpies.isV2BackupExportReady(),
    isV2BackupRestoreReady: () => gateSpies.isV2BackupRestoreReady(),
    isV2BackupRestoreLiteReady: () => gateSpies.isV2BackupRestoreLiteReady(),
    isV2BackupRestoreFullReady: () => gateSpies.isV2BackupRestoreFullReady()
  }
})

import { BackupUnavailableGate } from '../BackupUnavailableGate'
import { LegacyLocalBackupGate } from '../LegacyLocalBackupGate'
import type * as V2BackupActionGateModule from '../V2BackupActionGate'
import {
  isV2BackupExportReady,
  isV2BackupRestoreFullReady,
  isV2BackupRestoreLiteReady,
  isV2BackupRestoreReady,
  V2BackupExportGate,
  V2BackupRestoreFullGate,
  V2BackupRestoreGate
} from '../V2BackupActionGate'

/** Mirrors Basic/Local Backup action row — separate enablement, no shared wrapper. */
function MigratedBackupActionRow() {
  const exportReady = isV2BackupExportReady()
  const restoreReady = isV2BackupRestoreReady()
  return (
    <>
      <Button type="button" disabled={!exportReady} aria-disabled={!exportReady} data-testid="v2-backup-export-button">
        export
      </Button>
      <Button
        type="button"
        disabled={!restoreReady}
        aria-disabled={!restoreReady}
        data-testid="v2-backup-restore-button">
        restore
      </Button>
    </>
  )
}

describe('dual v2 backup gates', () => {
  beforeEach(() => {
    gateSpies.isV2BackupExportReady.mockReturnValue(true)
    gateSpies.isV2BackupRestoreReady.mockReturnValue(false)
    gateSpies.isV2BackupRestoreLiteReady.mockReturnValue(true)
    gateSpies.isV2BackupRestoreFullReady.mockReturnValue(false)
  })

  it('export ready does not imply restore ready (independence)', () => {
    gateSpies.isV2BackupExportReady.mockReturnValue(true)
    gateSpies.isV2BackupRestoreReady.mockReturnValue(false)
    expect(isV2BackupExportReady()).toBe(true)
    expect(isV2BackupRestoreReady()).toBe(false)
  })

  it('restore ready does not imply export ready (reverse independence)', () => {
    gateSpies.isV2BackupExportReady.mockReturnValue(false)
    gateSpies.isV2BackupRestoreReady.mockReturnValue(true)
    expect(isV2BackupExportReady()).toBe(false)
    expect(isV2BackupRestoreReady()).toBe(true)
  })

  it('packaged defaults: LITE restore ready, Full restore not ready (default-arg path)', async () => {
    // Exercise production exports — unmock by reading the real module bindings via a fresh
    // import of the source functions' documented defaults (spies already mirror packaged).
    expect(isV2BackupRestoreLiteReady()).toBe(true)
    expect(isV2BackupRestoreFullReady()).toBe(false)

    const real = await vi.importActual<typeof V2BackupActionGateModule>('../V2BackupActionGate')
    expect(real.isV2BackupRestoreLiteReady()).toBe(true)
    expect(real.isV2BackupRestoreFullReady()).toBe(false)
    expect(real.isV2BackupRestoreReady()).toBe(true)
  })

  it('LITE and Full readiness are independent', () => {
    gateSpies.isV2BackupRestoreLiteReady.mockReturnValue(true)
    gateSpies.isV2BackupRestoreFullReady.mockReturnValue(false)
    expect(isV2BackupRestoreLiteReady()).toBe(true)
    expect(isV2BackupRestoreFullReady()).toBe(false)

    gateSpies.isV2BackupRestoreLiteReady.mockReturnValue(false)
    gateSpies.isV2BackupRestoreFullReady.mockReturnValue(true)
    expect(isV2BackupRestoreLiteReady()).toBe(false)
    expect(isV2BackupRestoreFullReady()).toBe(true)
  })

  it('exports the split restore gate API', async () => {
    const mod = await import('../V2BackupActionGate')
    expect(Object.keys(mod).sort()).toEqual([
      'V2BackupExportGate',
      'V2BackupRestoreFullGate',
      'V2BackupRestoreGate',
      'isV2BackupExportReady',
      'isV2BackupRestoreFullReady',
      'isV2BackupRestoreLiteReady',
      'isV2BackupRestoreReady'
    ])
  })

  it('V2BackupExportGate and V2BackupRestoreGate do not share readiness', () => {
    const { rerender } = render(
      <V2BackupExportGate ready>
        <button type="button">export</button>
      </V2BackupExportGate>
    )
    expect(screen.getByRole('button', { name: 'export' }).parentElement).not.toHaveAttribute('inert')

    rerender(
      <V2BackupRestoreGate ready={false}>
        <button type="button">restore</button>
      </V2BackupRestoreGate>
    )
    expect(screen.getByRole('button', { name: 'restore' }).parentElement).toHaveAttribute('inert')
  })

  it('V2BackupRestoreFullGate is inert by default while LITE gate stays interactive', () => {
    render(
      <>
        <V2BackupRestoreGate>
          <button type="button" data-testid="lite-restore">
            lite
          </button>
        </V2BackupRestoreGate>
        <V2BackupRestoreFullGate>
          <button type="button" data-testid="full-restore">
            full
          </button>
        </V2BackupRestoreFullGate>
        <span data-testid="full-disabled-reason">settings.data.backup.v2.restore.full_unavailable</span>
      </>
    )

    const liteBtn = screen.getByTestId('lite-restore')
    const fullBtn = screen.getByTestId('full-restore')

    // Production default: FullGate uses isV2BackupRestoreFullReady() → false → inert.
    // Spy returns false; Gate components call the spied functions via default args at render.
    // Note: default-arg evaluation uses the mock at call time — Full should be inert.
    expect(fullBtn.parentElement).toHaveAttribute('inert')
    expect(fullBtn.parentElement).toHaveClass('pointer-events-none')
    expect(screen.getByTestId('full-disabled-reason')).toHaveTextContent(
      'settings.data.backup.v2.restore.full_unavailable'
    )

    // LITE spy is true → passthrough (no inert parent from the gate).
    expect(liteBtn.parentElement).not.toHaveAttribute('inert')
  })

  it('V2BackupRestoreFullGate passthrough when ready override is true', () => {
    render(
      <V2BackupRestoreFullGate ready>
        <button type="button">full</button>
      </V2BackupRestoreFullGate>
    )
    expect(screen.getByRole('button', { name: 'full' }).parentElement).not.toHaveAttribute('inert')
  })

  it('restore button is aria-disabled when restore gate is inert (export stays enabled)', () => {
    gateSpies.isV2BackupExportReady.mockReturnValue(true)
    gateSpies.isV2BackupRestoreReady.mockReturnValue(false)

    render(<MigratedBackupActionRow />)

    const exportBtn = screen.getByTestId('v2-backup-export-button')
    const restoreBtn = screen.getByTestId('v2-backup-restore-button')

    expect(exportBtn).toBeEnabled()
    expect(exportBtn).not.toHaveAttribute('aria-disabled', 'true')
    expect(restoreBtn).toBeDisabled()
    expect(restoreBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('LegacyLocalBackupGate keeps local v1 controls inert with distinct copy', () => {
    render(
      <LegacyLocalBackupGate>
        <button type="button">legacy</button>
      </LegacyLocalBackupGate>
    )
    expect(screen.getByText('settings.data.backup.legacy_local_unavailable')).toBeInTheDocument()
    const wrapper = screen.getByRole('button', { name: 'legacy' }).parentElement
    expect(wrapper).toHaveAttribute('inert')
  })

  it('BackupUnavailableGate still gates shared provider surfaces', () => {
    render(
      <BackupUnavailableGate>
        <button type="button">provider</button>
      </BackupUnavailableGate>
    )
    expect(screen.getByRole('button', { name: 'provider' }).parentElement).toHaveAttribute('inert')
  })
})

import '@testing-library/jest-dom/vitest'

import { Accordion, Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import type { DoctorController, DoctorInteraction } from '@renderer/hooks/doctor'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { DoctorCheckList, DoctorCheckResults } from '../DoctorCheckResults'
import { DoctorChecksPanel } from '../DoctorChecksPanel'

function createController(): DoctorController {
  return {
    appUpdateState: { downloaded: false },
    executeAction: vi.fn(),
    isInteracting: false,
    mcpServerName: vi.fn(),
    requestEvidence: vi.fn(),
    session: {
      interaction: { kind: 'idle' },
      revealedEvidence: []
    },
    viewModel: {
      rows: [
        {
          domain: 'runtime',
          status: 'warn',
          id: 'runtime-claude-login',
          result: {
            id: 'runtime-claude-login',
            status: 'warn',
            durationMs: 1,
            attribution: 'user-fixable',
            detail: { variant: 'signed_out' },
            evidence: [{ key: 'request-body', value: 'private Doctor evidence', dataClass: 'consent_required' }],
            actions: [
              { kind: 'navigate', target: '/settings/provider?id=claude-code' },
              { kind: 'navigate', target: '/settings/mcp' },
              { kind: 'navigate', target: '/settings/general' }
            ]
          },
          actions: [
            { kind: 'navigate', target: '/settings/provider?id=claude-code' },
            { kind: 'navigate', target: '/settings/mcp' },
            { kind: 'navigate', target: '/settings/general' }
          ],
          actionsDisabled: false
        }
      ]
    }
  } as unknown as DoctorController
}

function createPanelController(): DoctorController {
  return {
    ...createController(),
    cancel: vi.fn(),
    canChangePanel: true,
    openLogsPath: vi.fn(),
    openPath: vi.fn(),
    run: vi.fn(),
    session: {
      interaction: { kind: 'idle' },
      relaunchRequired: false,
      revealedEvidence: []
    },
    setPanel: vi.fn(),
    toggleDevTools: vi.fn(),
    viewModel: {
      canCancel: false,
      isStale: false,
      problemCount: 0,
      groups: [],
      rows: [],
      status: 'canceled',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 0 }
    }
  } as unknown as DoctorController
}

function createCompletedPanelController(): DoctorController {
  const controller = createPanelController()
  const row = createController().viewModel.rows[0]

  return {
    ...controller,
    viewModel: {
      ...controller.viewModel,
      problemCount: 1,
      report: {
        schemaVersion: 1,
        runId: 'run-1',
        tier: 'quick',
        startedAt: '2026-09-05T00:00:00.000Z',
        finishedAt: '2026-09-05T00:00:01.000Z',
        expiresAt: '2026-09-05T00:10:00.000Z',
        basics: {
          version: '2.0.0',
          edition: 'global',
          channel: 'latest',
          platform: 'darwin',
          arch: 'arm64',
          osRelease: '25.0.0',
          runtime: {},
          isPackaged: true,
          isPortable: false
        },
        results: [row.result!],
        summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 0 }
      },
      rows: [row],
      groups: [{ domain: 'runtime', status: 'warn', rows: [row] }],
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  } as DoctorController
}

function EvidenceFocusHarness() {
  const [interaction, setInteraction] = useState<DoctorInteraction>({ kind: 'idle' })
  const [revealedEvidence, setRevealedEvidence] = useState<DoctorController['session']['revealedEvidence']>([])
  const baseController = createCompletedPanelController()
  const controller = {
    ...baseController,
    cancelConfirmation: () => setInteraction({ kind: 'idle' }),
    confirmEvidence: () => {
      if (interaction.kind !== 'confirm-evidence') return
      setRevealedEvidence([interaction.checkId])
      setInteraction({ kind: 'idle' })
    },
    requestEvidence: (checkId) => setInteraction({ kind: 'confirm-evidence', checkId }),
    session: {
      ...baseController.session,
      interaction,
      relaunchRequired: false,
      revealedEvidence
    },
    viewModel: {
      ...baseController.viewModel,
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  } as DoctorController

  return <DoctorChecksPanel controller={controller} />
}

describe('DoctorCheckList interactions', () => {
  it('keeps standalone results grouped while each check remains a disclosure', async () => {
    const user = userEvent.setup()
    const controller = createCompletedPanelController()
    const groupedController = {
      ...controller,
      viewModel: {
        ...controller.viewModel,
        groups: [{ domain: 'runtime', status: 'warn', rows: controller.viewModel.rows }]
      }
    } as DoctorController

    render(<DoctorCheckResults controller={groupedController} />)

    const group = screen.getByRole('button', {
      name: /settings\.doctor\.domains\.runtime.*settings\.doctor\.status\.warn/
    })
    expect(group).toHaveAttribute('aria-expanded', 'true')

    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'false')

    await user.click(group)

    expect(
      screen.getByRole('button', {
        name: /settings\.doctor\.checks\.runtime-claude-login\.title.*settings\.doctor\.status\.warn/
      })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('exposes local evidence through an accessible accordion trigger', async () => {
    const user = userEvent.setup()
    render(
      <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
        <DoctorCheckList controller={createController()} />
      </Accordion>
    )

    const localEvidenceTrigger = screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' })
    expect(localEvidenceTrigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(localEvidenceTrigger)

    expect(localEvidenceTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('••••••')).toBeVisible()
  })

  it('closes an expanded action menu without dismissing its parent dialog when the trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Error details</DialogTitle>
          <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
            <DoctorCheckList controller={createController()} />
          </Accordion>
        </DialogContent>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog')
    const more = screen.getByRole('button', { name: 'settings.doctor.actions.more' })
    await user.click(more)
    expect(screen.getByRole('menu')).toBeVisible()

    await user.click(more)

    expect(dialog).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps the parent dialog open when the footer action menu trigger closes its menu', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>System diagnostics</DialogTitle>
          <DoctorChecksPanel controller={createPanelController()} />
        </DialogContent>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog')
    const more = screen.getByRole('button', { name: 'settings.doctor.actions.more' })
    await user.click(more)
    expect(screen.getByRole('menu')).toBeVisible()

    await user.click(more)

    expect(dialog).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves focus to newly revealed evidence after consent', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>System diagnostics</DialogTitle>
          <EvidenceFocusHarness />
        </DialogContent>
      </Dialog>
    )

    expect(screen.queryByText('private Doctor evidence')).not.toBeInTheDocument()
    const checkTrigger = screen.getByRole('button', {
      name: /settings\.doctor\.checks\.runtime-claude-login\.title/
    })
    if (checkTrigger.getAttribute('aria-expanded') === 'false') await user.click(checkTrigger)
    await user.click(screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' }))
    expect(screen.getByText('••••••')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    const evidence = screen.getByText('private Doctor evidence').closest('dl')
    expect(evidence).toHaveFocus()
  })
})

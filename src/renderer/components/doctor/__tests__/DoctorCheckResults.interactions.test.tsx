import '@testing-library/jest-dom/vitest'

import { Accordion, Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import type { DoctorController } from '@renderer/hooks/doctor'
import type { DoctorInteraction } from '@renderer/hooks/doctor/doctorSessionReducer'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  mcpServers: [{ id: 'filesystem', name: 'Filesystem' }]
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: mocks.mcpServers })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) => {
      if (key === 'settings.doctor.fixes.restart_mcp') return `Restart ${params?.name}`
      if (key === 'settings.doctor.fixes.restart_mcp_generic') return 'Restart MCP service'
      return key
    }
  })
}))

import { DoctorCheckAccordionItems, DoctorCheckResults } from '../DoctorCheckResults'
import { DoctorChecksPanel } from '../DoctorChecksPanel'

type ControllerOverrides = {
  readonly cancelConfirmation?: DoctorController['cancelConfirmation']
  readonly confirmEvidence?: DoctorController['confirmEvidence']
  readonly requestEvidence?: DoctorController['requestEvidence']
  readonly session?: Partial<DoctorController['session']>
  readonly viewModel?: Partial<DoctorController['viewModel']>
}

function createController(overrides: ControllerOverrides = {}) {
  const baseController = {
    appUpdateState: {
      info: null,
      checking: false,
      downloading: false,
      downloaded: false,
      downloadProgress: 0,
      available: false,
      ignore: false,
      manualCheck: false
    },
    cancel: vi.fn<DoctorController['cancel']>(),
    canChangePanel: true,
    cancelConfirmation: vi.fn<DoctorController['cancelConfirmation']>(),
    confirmEvidence: vi.fn<DoctorController['confirmEvidence']>(),
    executeAction: vi.fn<DoctorController['executeAction']>(),
    isInteracting: false,
    isCloseBlocked: false,
    openLogsPath: vi.fn<DoctorController['openLogsPath']>(),
    openPath: vi.fn<DoctorController['openPath']>(),
    requestEvidence: vi.fn<DoctorController['requestEvidence']>(),
    run: vi.fn<DoctorController['run']>(),
    session: {
      activePanel: 'checks',
      descriptionDraft: '',
      interaction: { kind: 'idle' },
      relaunchRequired: false,
      revealedEvidence: []
    },
    setDescription: vi.fn<DoctorController['setDescription']>(),
    setPanel: vi.fn<DoctorController['setPanel']>(),
    setPanelInteraction: vi.fn<DoctorController['setPanelInteraction']>(),
    toggleDevTools: vi.fn<DoctorController['toggleDevTools']>(),
    viewModel: {
      canCancel: false,
      groups: [],
      isStale: false,
      problemCount: 1,
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
            detail: { variant: 'not_logged_in' },
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
      ],
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  } satisfies DoctorController

  return {
    ...baseController,
    ...overrides,
    session: { ...baseController.session, ...overrides.session },
    viewModel: { ...baseController.viewModel, ...overrides.viewModel }
  } satisfies DoctorController
}

function createPanelController() {
  return createController({
    viewModel: {
      groups: [],
      problemCount: 0,
      rows: [],
      status: 'canceled',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 0 }
    }
  })
}

function createCompletedPanelController() {
  const controller = createPanelController()
  const row = createController().viewModel.rows[0]

  return createController({
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
  })
}

function createSecondaryEvidencePanelController() {
  const controller = createCompletedPanelController()
  const evidenceRow = controller.viewModel.rows[0]
  const firstRow = {
    domain: 'runtime',
    status: 'warn',
    id: 'runtime-managed-tools',
    result: {
      id: 'runtime-managed-tools',
      status: 'warn',
      durationMs: 1,
      attribution: 'user-fixable',
      detail: { variant: 'failed' },
      evidence: [],
      actions: []
    },
    actions: [],
    actionsDisabled: false
  } satisfies DoctorController['viewModel']['rows'][number]
  const rows = [firstRow, evidenceRow]

  return createController({
    viewModel: {
      ...controller.viewModel,
      rows,
      groups: [{ domain: 'runtime', status: 'warn', rows }]
    }
  })
}

function EvidenceFocusHarness() {
  const [interaction, setInteraction] = useState<DoctorInteraction>({ kind: 'idle' })
  const [revealedEvidence, setRevealedEvidence] = useState<DoctorController['session']['revealedEvidence']>([])
  const baseController = createSecondaryEvidencePanelController()
  const controller = createController({
    cancelConfirmation: () => setInteraction({ kind: 'idle' }),
    confirmEvidence: () => {
      if (interaction.kind !== 'confirm-evidence') return
      setRevealedEvidence([interaction.checkId])
      setInteraction({ kind: 'idle' })
    },
    requestEvidence: (checkId) => setInteraction({ kind: 'confirm-evidence', checkId }),
    session: {
      interaction,
      revealedEvidence
    },
    viewModel: {
      ...baseController.viewModel,
      status: 'completed',
      summary: { appBug: 0, error: 0, skip: 0, transient: 0, userFixable: 1 }
    }
  })

  return <DoctorChecksPanel controller={controller} />
}

describe('DoctorCheckAccordionItems interactions', () => {
  it('keeps the test controller surface in sync with production', () => {
    expectTypeOf<keyof ReturnType<typeof createController>>().toEqualTypeOf<keyof DoctorController>()
  })

  it('keeps standalone results grouped while each check remains a disclosure', async () => {
    const user = userEvent.setup()
    const controller = createCompletedPanelController()
    const groupedController = createController({
      viewModel: {
        ...controller.viewModel,
        groups: [{ domain: 'runtime', status: 'warn', rows: controller.viewModel.rows }]
      }
    })

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
        <DoctorCheckAccordionItems controller={createController()} />
      </Accordion>
    )

    const localEvidenceTrigger = screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' })
    expect(localEvidenceTrigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(localEvidenceTrigger)

    expect(localEvidenceTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('••••••')).toBeVisible()
  })

  it('labels current and deleted MCP restart targets from the display owner', async () => {
    const user = userEvent.setup()
    const actions = [
      { kind: 'fix', fixId: 'restart', target: 'filesystem' },
      { kind: 'fix', fixId: 'restart', target: 'deleted' }
    ] as const
    const row = {
      domain: 'mcp',
      status: 'warn',
      id: 'mcp-servers-connected',
      result: {
        id: 'mcp-servers-connected',
        status: 'warn',
        durationMs: 1,
        attribution: 'user-fixable',
        detail: { variant: 'server_errors' },
        actions
      },
      actions,
      actionsDisabled: false
    } satisfies DoctorController['viewModel']['rows'][number]
    const controller = createController({ viewModel: { rows: [row] } })

    render(
      <Accordion type="single" collapsible defaultValue="doctor-mcp-servers-connected">
        <DoctorCheckAccordionItems controller={controller} />
      </Accordion>
    )

    expect(screen.getByRole('button', { name: 'Restart Filesystem' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.more' }))
    expect(screen.getByRole('menuitem', { name: 'Restart MCP service' })).toBeVisible()
  })

  it('closes an expanded action menu without dismissing its parent dialog when the trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Error details</DialogTitle>
          <Accordion type="single" collapsible defaultValue="doctor-runtime-claude-login">
            <DoctorCheckAccordionItems controller={createController()} />
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

  it('keeps disclosure state and restores the evidence trigger after canceling consent', async () => {
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
    const localDetails = screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' })
    await user.click(localDetails)
    expect(screen.getByText('••••••')).toBeInTheDocument()
    const showDetails = screen.getByRole('button', { name: 'settings.doctor.actions.show_details' })
    await user.click(showDetails)

    const confirmation = await screen.findByRole('dialog', { name: 'settings.doctor.confirm_evidence.title' })
    await user.keyboard('{Escape}')

    expect(confirmation).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'System diagnostics' })).toBeVisible()
    expect(localDetails).toHaveAttribute('aria-expanded', 'true')
    expect(showDetails).toHaveFocus()
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

    const checkTrigger = screen.getByRole('button', {
      name: /settings\.doctor\.checks\.runtime-claude-login\.title/
    })
    if (checkTrigger.getAttribute('aria-expanded') === 'false') await user.click(checkTrigger)
    await user.click(screen.getByRole('button', { name: 'settings.doctor.evidence.local_details' }))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    const confirmation = await screen.findByRole('dialog', { name: 'settings.doctor.confirm_evidence.title' })
    await user.click(within(confirmation).getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    const evidence = screen.getByText('private Doctor evidence').closest('dl')
    expect(evidence).toHaveFocus()
  })
})

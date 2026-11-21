import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { SkillReadinessControls } from '../SkillReadinessControls'

const missing = {
  state: 'setup_required' as const,
  missing: ['pip pypdf==5.1.0'],
  fingerprint: 'before',
  checkedAt: '2026-11-21'
}
const plan = {
  skillId: 'skill-1',
  approvalId: 'approval-1',
  expiresAt: '2026-11-21',
  directory: '/app/env/run-1',
  packages: ['pypdf==5.1.0'],
  commands: [{ executable: '/usr/bin/python3', args: ['-I', '-m', 'venv', '/app/env/run-1/venv'] }],
  warnings: ['Downloads packages and executes package code. Disk usage is not limited.']
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockImplementation(async (route) => {
    if (route === 'skill.preflight') return missing
    if (route === 'skill.setup.plan') return plan
    if (route === 'skill.setup.approve') return { ...missing, state: 'ready', missing: [] }
  })
})

describe('SkillReadinessControls', () => {
  it('displays missing prerequisites and does not run setup before explicit approval of exact commands', async () => {
    render(<SkillReadinessControls skillId="skill-1" readiness={missing} onChange={() => {}} />)
    expect(screen.getByText('pip pypdf==5.1.0')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'settings.skills.readiness.setup' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('pypdf==5.1.0')).toBeVisible()
    expect(
      within(dialog).getByText(JSON.stringify(['/usr/bin/python3', '-I', '-m', 'venv', '/app/env/run-1/venv']))
    ).toBeVisible()
    expect(within(dialog).getByText(plan.warnings[0])).toBeVisible()
    expect(mocks.request).not.toHaveBeenCalledWith('skill.setup.approve', expect.anything())
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.skills.readiness.approve' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('skill.setup.approve', {
        skillId: 'skill-1',
        approvalId: 'approval-1'
      })
    )
    expect(await screen.findByText('settings.skills.readiness.ready')).toBeVisible()
  })
  it('dismisses a plan without approving or starting it', async () => {
    render(<SkillReadinessControls skillId="skill-1" readiness={missing} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.skills.readiness.setup' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }))
    expect(mocks.request).not.toHaveBeenCalledWith('skill.setup.approve', expect.anything())
  })
  it('shows failure and log and prepares a new approval for retry, not a silent rerun', async () => {
    const failed = {
      ...missing,
      state: 'failed' as const,
      error: 'Package failed',
      logPath: '/app/env/run-1/setup.log'
    }
    mocks.request.mockImplementation(async (route) =>
      route === 'skill.preflight' ? failed : { ...plan, approvalId: 'new-approval' }
    )
    render(<SkillReadinessControls skillId="skill-1" readiness={failed} onChange={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Package failed')
    expect(screen.getByText(/run-1\/setup.log/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'settings.skills.readiness.retry' }))
    await screen.findByRole('dialog')
    expect(mocks.request).toHaveBeenCalledWith('skill.setup.plan', { skillId: 'skill-1' })
    expect(mocks.request).not.toHaveBeenCalledWith('skill.setup.approve', expect.anything())
  })
  it('offers cancellation during setup while preserving the progress and log display', async () => {
    const running = { ...missing, state: 'setting_up' as const, logPath: '/app/env/run-1/setup.log' }
    mocks.request.mockResolvedValue(running)
    render(<SkillReadinessControls skillId="skill-1" readiness={running} onChange={() => {}} />)
    expect(screen.getByText('settings.skills.readiness.setting_up')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('skill.setup.cancel', { skillId: 'skill-1' }))
  })
})

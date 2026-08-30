import type { InstalledSkill } from '@shared/data/types/agent'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enableSkill: vi.fn(),
  ipcRequest: vi.fn(),
  openRoute: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: mocks.enableSkill })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute: mocks.openRoute }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: ({
    cancelText,
    confirmText,
    onConfirm,
    onOpenChange,
    open
  }: {
    cancelText: ReactNode
    confirmText: ReactNode
    onConfirm: () => Promise<void>
    onOpenChange: (open: boolean) => void
    open: boolean
  }) =>
    open ? (
      <div role="dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          {cancelText}
        </button>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmText}
        </button>
      </div>
    ) : null
}))

import { SkillLauncherProvider, useSkillLauncher } from '../useSkillLauncher'

function createSkill(isGlobalEnabled: boolean): InstalledSkill {
  return {
    id: 'skill-1',
    name: 'Writer',
    description: null,
    folderName: 'writer',
    source: 'local',
    sourceUrl: null,
    namespace: null,
    author: null,
    version: null,
    sourceTags: [],
    contentHash: 'hash',
    sourceRegistry: null,
    canUpdateFromRemote: false,
    isGlobalEnabled,
    isEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function LauncherProbe({ skill }: { skill: InstalledSkill }) {
  const launchSkill = useSkillLauncher()
  return (
    <button type="button" onClick={() => void launchSkill(skill)}>
      Launch
    </button>
  )
}

function renderLauncher(skill: InstalledSkill) {
  return render(
    <SkillLauncherProvider>
      <LauncherProbe skill={skill} />
    </SkillLauncherProvider>
  )
}

describe('useSkillLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enableSkill.mockImplementation(async () => createSkill(true))
    mocks.ipcRequest.mockResolvedValue({ sessionId: 'session-1' })
  })

  it('creates one prepared Skill session and opens the Agent route for an enabled Skill', async () => {
    const user = userEvent.setup()
    renderLauncher(createSkill(true))

    await user.click(screen.getByRole('button', { name: 'Launch' }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('ai.agent.skill_session.create', {
        skillId: 'skill-1'
      })
    )
    expect(mocks.openRoute).toHaveBeenCalledExactlyOnceWith('/app/agents', {
      intent: 'skill',
      sessionId: 'session-1',
      skillId: 'skill-1'
    })
  })

  it('does not enable or create a session when the disabled-Skill confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderLauncher(createSkill(false))

    await user.click(screen.getByRole('button', { name: 'Launch' }))
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(mocks.enableSkill).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('enables a disabled Skill before creating its prepared session', async () => {
    const user = userEvent.setup()
    renderLauncher(createSkill(false))

    await user.click(screen.getByRole('button', { name: 'Launch' }))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.skills.enableToTry.confirm' }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledOnce())
    expect(mocks.enableSkill).toHaveBeenCalledExactlyOnceWith({
      params: { skillId: 'skill-1' },
      body: { isGlobalEnabled: true }
    })
    expect(mocks.enableSkill.mock.invocationCallOrder[0]).toBeLessThan(mocks.ipcRequest.mock.invocationCallOrder[0])
  })

  it('does not create an empty session when enabling the Skill fails', async () => {
    const user = userEvent.setup()
    mocks.enableSkill.mockRejectedValueOnce(new Error('enable failed'))
    renderLauncher(createSkill(false))

    await user.click(screen.getByRole('button', { name: 'Launch' }))
    await user.click(screen.getByRole('button', { name: 'settings.skills.enableToTry.confirm' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('settings.skills.launchFailed'))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(mocks.openRoute).not.toHaveBeenCalled()
  })
})

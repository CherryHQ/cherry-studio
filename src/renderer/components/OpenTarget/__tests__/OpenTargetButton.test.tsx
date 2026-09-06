import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTarget: vi.fn(),
  usePreferredExternalOpenTarget: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/hooks/useExternalOpenTargets', () => ({
  usePreferredExternalOpenTarget: mocks.usePreferredExternalOpenTarget
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'common.open_in') return `Open in ${values?.name}`
      if (key === 'files.error.open_path') return `Failed to open ${values?.path}`
      if (key === 'agent.preview_pane.default_app') return 'Default app'
      return key
    }
  })
}))

import { OpenTargetButton } from '../OpenTargetButton'

const selectedTarget: ExternalOpenTarget = {
  id: 'known:vscode',
  name: 'Visual Studio Code',
  kind: 'application'
}

const fileManagerTarget: ExternalOpenTarget = {
  id: 'file_manager',
  kind: 'file_manager'
}

describe('OpenTargetButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openTarget.mockResolvedValue(undefined)
    mocks.usePreferredExternalOpenTarget.mockReturnValue({
      targets: [selectedTarget],
      selectedTarget,
      openTarget: mocks.openTarget
    })
  })

  it('opens the selected target from the primary button', async () => {
    const user = userEvent.setup()
    render(<OpenTargetButton targetPath="/tmp/README.md" pathKind="file" />)

    await user.click(screen.getByRole('button', { name: 'Open in Visual Studio Code' }))

    expect(mocks.openTarget).toHaveBeenCalledWith(selectedTarget)
  })

  it('keeps a custom workspace trigger as the primary action with a separate target menu', async () => {
    const user = userEvent.setup()
    mocks.usePreferredExternalOpenTarget.mockReturnValue({
      targets: [fileManagerTarget, selectedTarget],
      selectedTarget,
      openTarget: mocks.openTarget
    })
    render(<OpenTargetButton targetPath="/tmp/My Workspace" pathKind="directory" primaryContent="Open workspace" />)

    await user.click(screen.getByRole('button', { name: 'Open workspace' }))

    expect(mocks.openTarget).toHaveBeenCalledWith(selectedTarget)

    await user.click(screen.getByRole('button', { name: 'common.more' }))
    await user.click(screen.getByRole('button', { name: /agent\.session\.file_manager/ }))

    expect(mocks.openTarget).toHaveBeenLastCalledWith(fileManagerTarget)
  })

  it('reports a launch failure', async () => {
    const user = userEvent.setup()
    mocks.openTarget.mockRejectedValue(new Error('launch failed'))
    render(<OpenTargetButton targetPath="/tmp/README.md" pathKind="file" />)

    await user.click(screen.getByRole('button', { name: 'Open in Visual Studio Code' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to open /tmp/README.md: launch failed'))
  })
})

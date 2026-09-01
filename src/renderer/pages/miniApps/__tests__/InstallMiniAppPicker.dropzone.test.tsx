import type * as CherryStudioUI from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { InstallMiniAppPicker } from '../InstallMiniAppPanel'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@cherrystudio/ui', async () => vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui'))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

let previousLanguage: string
beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

beforeEach(() => {
  request.mockReset().mockResolvedValue(null)
})

describe('InstallMiniAppPicker dropzone', () => {
  it('previews a dropped .miniapp package through its absolute file path', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/mygame.miniapp')
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    fireEvent.drop(screen.getByRole('button', { name: /choose file/i }), {
      dataTransfer: {
        files: [new File(['package'], 'mygame.miniapp')],
        types: ['Files'],
        dropEffect: 'none'
      }
    })

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.install.preview_file', {
        filePath: '/tmp/mygame.miniapp'
      })
    )
  })

  it('keeps the native picker route when the dropzone is clicked', async () => {
    const user = userEvent.setup()
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /choose file/i }))

    expect(request).toHaveBeenCalledWith('mini_app.install.pick_and_preview')
  })
})

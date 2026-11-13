import { render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ComputerUseAppIcons } from '../ComputerUseAppIcons'

vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/avatar'))

const originalImage = globalThis.Image

class LoadedImage {
  complete = true
  naturalWidth = 64
  src = ''
  addEventListener() {}
  removeEventListener() {}
}
function Cache({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
}
const first = '12345678-1234-4234-8234-123456789abc'
const second = '12345678-1234-4234-8234-123456789abd'

beforeEach(() => {
  vi.stubGlobal('Image', LoadedImage)
  vi.mocked(window.api.ipcApi.request).mockReset()
})
afterEach(() => {
  globalThis.Image = originalImage
})

it('shows all actual call targets and shares icon requests across calls', async () => {
  let iconQueries = 0
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, input) => {
    if (route === 'computer_use.get_call_apps')
      return {
        ok: true,
        data:
          input && typeof input === 'object' && 'cell' in input && input.cell === first
            ? [
                { id: 'finder', name: 'Finder', identity: 'com.apple.finder' },
                { id: 'terminal', name: 'Terminal' }
              ]
            : [{ id: 'finder', name: 'Finder', identity: 'com.apple.finder' }]
      }
    iconQueries++
    return { ok: true, data: { status: 'available', icon: { mimeType: 'image/png', dataBase64: 'aWNvbg==' } } }
  })
  render(
    <>
      <ComputerUseAppIcons cell={first} fallback={<span>Script icon</span>} />
      <ComputerUseAppIcons cell={second} />
    </>,
    { wrapper: Cache }
  )
  await waitFor(() => expect(screen.getAllByRole('img', { name: 'Finder' })).toHaveLength(2))
  await waitFor(() =>
    expect(screen.getAllByRole('img', { name: 'Finder' })[0]).toHaveAttribute('src', 'data:image/png;base64,aWNvbg==')
  )
  expect(screen.getByRole('img', { name: 'Terminal' })).not.toHaveAttribute('src')
  expect(screen.queryByText('Script icon')).not.toBeInTheDocument()
  expect(iconQueries).toBe(1)
})

it('removes old targets when changing calls and never guesses a target without a cell', async () => {
  vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: [{ id: 'finder', name: 'Finder' }] })
  const { rerender } = render(<ComputerUseAppIcons cell={first} fallback={<span>Script icon</span>} />, {
    wrapper: Cache
  })
  expect(await screen.findByRole('img', { name: 'Finder' })).toBeInTheDocument()
  rerender(<ComputerUseAppIcons fallback={<span>Script icon</span>} />)
  expect(screen.getByText('Script icon')).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: [] })
  rerender(<ComputerUseAppIcons cell={second} />)
  await waitFor(() =>
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('computer_use.get_call_apps', { cell: second })
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it.each(['unavailable', 'broken'])('retains an accessible fallback for an %s icon', async (mode) => {
  if (mode === 'broken')
    vi.stubGlobal(
      'Image',
      class extends LoadedImage {
        naturalWidth = 0
      }
    )
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) => ({
    ok: true,
    data:
      route === 'computer_use.get_call_apps'
        ? [{ id: 'finder', name: 'Finder', identity: 'com.apple.finder' }]
        : mode === 'unavailable'
          ? { status: 'unavailable' }
          : { status: 'available', icon: { mimeType: 'image/png', dataBase64: 'aWNvbg==' } }
  }))
  render(<ComputerUseAppIcons cell={first} fallback={<span>Script icon</span>} />, { wrapper: Cache })
  await waitFor(() =>
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('computer_use.get_app_icon', {
      identity: 'com.apple.finder'
    })
  )
  expect(screen.getByRole('img', { name: 'Finder' })).not.toHaveAttribute('src')
})

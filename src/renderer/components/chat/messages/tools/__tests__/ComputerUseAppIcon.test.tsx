import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeToolOutputResponse } from '@renderer/utils/message/toolOutput'
import { COMPUTER_USE_APP_META_KEY } from '@shared/ai/tools/computerUse'

import { ComputerUseAppIcon } from '../ComputerUseAppIcon'

vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/avatar'))

// jsdom cannot load image data; only the browser image-loading boundary is stubbed.
class LoadedImage {
  complete = true
  naturalWidth = 64
  src = ''
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => vi.stubGlobal('Image', LoadedImage))
afterEach(() => vi.unstubAllGlobals())

describe('ComputerUseAppIcon', () => {
  it('keeps the selected app icon through tool-output normalization and switches targets', async () => {
    const output = (name: string, data: string) =>
      normalizeToolOutputResponse({
        content: [{ type: 'text', text: 'App state' }],
        _meta: { [COMPUTER_USE_APP_META_KEY]: { name, icon: { mimeType: 'image/png', data } } }
      })
    const { rerender } = render(<ComputerUseAppIcon output={output('Finder', 'aWNvbg==')} />)
    expect(await screen.findByRole('img', { name: 'Finder' })).toHaveAttribute('src', 'data:image/png;base64,aWNvbg==')
    rerender(<ComputerUseAppIcon output={output('Safari', 'c2FmYXJp')} />)
    expect(await screen.findByRole('img', { name: 'Safari' })).toHaveAttribute('src', 'data:image/png;base64,c2FmYXJp')
    expect(screen.queryByRole('img', { name: 'Finder' })).not.toBeInTheDocument()
    rerender(<ComputerUseAppIcon output={{ content: [{ type: 'text', text: 'Ordinary tool' }] }} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps a named fallback when the target has no icon', () => {
    render(<ComputerUseAppIcon output={{ _meta: { [COMPUTER_USE_APP_META_KEY]: { name: 'Finder' } } }} />)
    expect(screen.getByRole('img', { name: 'Finder' })).not.toHaveAttribute('src')
  })

  it('keeps the app identifiable if the browser cannot decode the icon', () => {
    vi.stubGlobal(
      'Image',
      class extends LoadedImage {
        naturalWidth = 0
      }
    )
    render(
      <ComputerUseAppIcon
        output={{
          _meta: { [COMPUTER_USE_APP_META_KEY]: { name: 'Finder', icon: { mimeType: 'image/png', data: 'aWNvbg==' } } }
        }}
      />
    )
    expect(screen.getByRole('img', { name: 'Finder' })).not.toHaveAttribute('src')
  })
})

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProcessorAvatar } from '../ProcessorAvatar'

const avatarMock = vi.fn()

vi.mock('../../utils/fileProcessingMeta', () => ({
  getProcessorLogo: () => ({
    Avatar: (props: any) => {
      avatarMock(props)
      return <span data-testid="processor-avatar" className={props.className} />
    }
  })
}))

afterEach(() => {
  cleanup()
  avatarMock.mockClear()
})

describe('ProcessorAvatar', () => {
  it('defaults to 16px (sm)', () => {
    render(<ProcessorAvatar processorId="system" />)

    expect(avatarMock).toHaveBeenCalledWith(expect.objectContaining({ size: 16, shape: 'rounded' }))
  })

  it('maps "md" to 22px', () => {
    render(<ProcessorAvatar processorId="system" size="md" />)

    expect(avatarMock).toHaveBeenCalledWith(expect.objectContaining({ size: 22 }))
  })

  it('maps "lg" to 36px', () => {
    render(<ProcessorAvatar processorId="system" size="lg" />)

    expect(avatarMock).toHaveBeenCalledWith(expect.objectContaining({ size: 36 }))
  })
})

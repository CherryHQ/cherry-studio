import type { RelocationProgress } from '@shared/types/userDataRelocation'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RelocationApp from '../RelocationApp'

const { useRelocationProgressMock } = vi.hoisted(() => ({ useRelocationProgressMock: vi.fn() }))
const restartMock = vi.fn()

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useRelocationProgress', () => ({ useRelocationProgress: useRelocationProgressMock }))

beforeEach(() => {
  restartMock.mockReset()
  useRelocationProgressMock.mockReturnValue({ progress: null, restart: restartMock })
})

describe('RelocationApp', () => {
  it('shows determinate copy progress and both relocation paths', () => {
    useRelocationProgressMock.mockReturnValue({
      progress: makeProgress('copying', { bytesCopied: 45, bytesTotal: 100 }),
      restart: restartMock
    })

    render(<RelocationApp />)

    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getByText('/old/data')).toBeInTheDocument()
    expect(screen.getByText('/new/data')).toBeInTheDocument()
  })

  it('offers restart after a completed relocation', () => {
    useRelocationProgressMock.mockReturnValue({ progress: makeProgress('completed'), restart: restartMock })

    render(<RelocationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'relocation.restart_success' }))

    expect(screen.getByText('relocation.completed.description')).toBeInTheDocument()
    expect(restartMock).toHaveBeenCalledOnce()
  })

  it('shows the failure detail and offers continuing with the previous directory', () => {
    useRelocationProgressMock.mockReturnValue({
      progress: makeProgress('failed', { error: 'disk full' }),
      restart: restartMock
    })

    render(<RelocationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'relocation.restart_failure' }))

    expect(screen.getByText('disk full')).toBeInTheDocument()
    expect(screen.getByText('relocation.failed.description')).toBeInTheDocument()
    expect(restartMock).toHaveBeenCalledOnce()
  })
})

function makeProgress(
  stage: RelocationProgress['stage'],
  overrides: Partial<RelocationProgress> = {}
): RelocationProgress {
  return {
    stage,
    from: '/old/data',
    to: '/new/data',
    bytesCopied: 0,
    bytesTotal: 0,
    ...overrides
  }
}

import type { RelocationProgress } from '@shared/data/relocation/types'
import { render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode
}

const relocationHookMock = vi.hoisted(() => ({
  progress: {
    bytesCopied: 25,
    bytesTotal: 100,
    copy: true,
    from: '/old/data',
    stage: 'copying',
    to: '/new/data'
  } as RelocationProgress | null,
  restart: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Button: ({ children, ...props }: MockButtonProps) => React.createElement('button', props, children)
  }
})

vi.mock('../hooks/useRelocationProgress', () => ({
  useRelocationProgress: () => ({
    progress: relocationHookMock.progress,
    restart: relocationHookMock.restart
  })
}))

import RelocationApp from '../RelocationApp'

describe('RelocationApp', () => {
  beforeEach(() => {
    relocationHookMock.progress = {
      bytesCopied: 25,
      bytesTotal: 100,
      copy: true,
      from: '/old/data',
      stage: 'copying',
      to: '/new/data'
    }
    relocationHookMock.restart.mockClear()
  })

  it('fills the relocation window and exposes a draggable title bar', () => {
    const { container } = render(<RelocationApp />)

    const shell = container.firstElementChild
    expect(shell).toHaveClass('h-screen', 'w-screen')

    const titleBar = screen.getByText('relocation.title').closest('header')
    expect(titleBar?.className).toContain('[-webkit-app-region:drag]')

    const content = container.querySelector('main')
    expect(content).toHaveClass('justify-center')
    expect(content?.className).toContain('[-webkit-app-region:no-drag]')
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('keeps the restart action clickable after failure', () => {
    relocationHookMock.progress = {
      bytesCopied: 100,
      bytesTotal: 100,
      copy: true,
      error: 'copy failed',
      from: '/old/data',
      stage: 'failed',
      to: '/new/data'
    }

    render(<RelocationApp />)

    screen.getByRole('button', { name: 'relocation.restart_failure' }).click()
    expect(relocationHookMock.restart).toHaveBeenCalledTimes(1)
  })
})

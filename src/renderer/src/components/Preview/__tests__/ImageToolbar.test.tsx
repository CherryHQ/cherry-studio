import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageToolbar from '../ImageToolbar'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

// Mock ImageToolButton
vi.mock('../ImageToolButton', () => ({
  default: vi.fn(({ tooltip, onClick, icon }) => (
    <button type="button" onClick={onClick} role="button" aria-label={tooltip}>
      {icon}
    </button>
  ))
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ChevronUp: () => <span data-testid="chevron-up">↑</span>,
  ChevronDown: () => <span data-testid="chevron-down">↓</span>,
  ChevronLeft: () => <span data-testid="chevron-left">←</span>,
  ChevronRight: () => <span data-testid="chevron-right">→</span>,
  ZoomIn: () => <span data-testid="zoom-in">+</span>,
  ZoomOut: () => <span data-testid="zoom-out">-</span>,
  Scan: () => <span data-testid="scan">⊞</span>
}))

vi.mock('@renderer/components/Icons', () => ({
  ResetIcon: () => <span data-testid="reset">↻</span>
}))

// Mock utils
vi.mock('@renderer/utils', () => ({
  classNames: (...args: any[]) => args.filter(Boolean).join(' ')
}))

describe('ImageToolbar', () => {
  const mockPan = vi.fn()
  const mockZoom = vi.fn()
  const mockOpenDialog = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should match snapshot', () => {
    const { asFragment } = render(<ImageToolbar pan={mockPan} zoom={mockZoom} dialog={mockOpenDialog} />)
    expect(asFragment()).toMatchSnapshot()
  })

  it('calls onPan with correct values when pan buttons are clicked', () => {
    render(<ImageToolbar pan={mockPan} zoom={mockZoom} dialog={mockOpenDialog} />)

    fireEvent.click(screen.getByRole('button', { name: 'preview.pan_up' }))
    expect(mockPan).toHaveBeenCalledWith(0, -20)

    fireEvent.click(screen.getByRole('button', { name: 'preview.pan_down' }))
    expect(mockPan).toHaveBeenCalledWith(0, 20)

    fireEvent.click(screen.getByRole('button', { name: 'preview.pan_left' }))
    expect(mockPan).toHaveBeenCalledWith(-20, 0)

    fireEvent.click(screen.getByRole('button', { name: 'preview.pan_right' }))
    expect(mockPan).toHaveBeenCalledWith(20, 0)
  })

  it('calls onZoom with correct values when zoom buttons are clicked', () => {
    render(<ImageToolbar pan={mockPan} zoom={mockZoom} dialog={mockOpenDialog} />)

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(mockZoom).toHaveBeenCalledWith(0.1)

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_out' }))
    expect(mockZoom).toHaveBeenCalledWith(-0.1)
  })

  it('calls onReset with correct values when reset button is clicked', () => {
    render(<ImageToolbar pan={mockPan} zoom={mockZoom} dialog={mockOpenDialog} />)

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    expect(mockPan).toHaveBeenCalledWith(0, 0, true)
    expect(mockZoom).toHaveBeenCalledWith(1, true)
  })

  it('calls onOpenDialog when dialog button is clicked', () => {
    render(<ImageToolbar pan={mockPan} zoom={mockZoom} dialog={mockOpenDialog} />)

    fireEvent.click(screen.getByRole('button', { name: 'preview.dialog' }))
    expect(mockOpenDialog).toHaveBeenCalled()
  })
})

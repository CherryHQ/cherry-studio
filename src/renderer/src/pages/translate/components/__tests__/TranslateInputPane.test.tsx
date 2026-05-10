import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import TranslateInputPane from '../TranslateInputPane'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useDrag', () => ({
  useDrag: (onDrop: (event: React.DragEvent<HTMLDivElement>) => void) => ({
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: onDrop
  })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const baseProps = () => ({
  text: 'hello',
  onTextChange: vi.fn(),
  onKeyDown: vi.fn(),
  onScroll: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSelectFile: vi.fn(),
  onCopy: vi.fn(),
  disabled: false,
  selecting: false,
  tokenCount: 2
})

describe('TranslateInputPane', () => {
  it('disables file upload while the parent pane is disabled', () => {
    const props = baseProps()
    render(<TranslateInputPane {...props} disabled />)

    fireEvent.click(screen.getByRole('button', { name: 'common.upload_files' }))

    expect(screen.getByRole('button', { name: 'common.upload_files' })).toBeDisabled()
    expect(props.onSelectFile).not.toHaveBeenCalled()
  })
})

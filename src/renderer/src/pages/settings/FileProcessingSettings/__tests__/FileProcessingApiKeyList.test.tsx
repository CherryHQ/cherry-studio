import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FileProcessingApiKeyList } from '../components/FileProcessingApiKeyList'

const setApiKeysMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  EditIcon: ({ size }: { size?: number }) => <span data-size={size}>edit</span>
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ asChild, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
    if (asChild) {
      return <>{children}</>
    }

    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: React.HTMLAttributes<HTMLDivElement> & { open?: boolean }) =>
    open === false ? null : <>{children}</>,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement> & { content?: React.ReactNode; delay?: number }) => (
    <>{children}</>
  )
}))

describe('FileProcessingApiKeyList', () => {
  beforeEach(() => {
    setApiKeysMock.mockReset()
    setApiKeysMock.mockResolvedValue(undefined)
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        confirm: vi.fn().mockResolvedValue(true)
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('adds API keys through the file processing list', async () => {
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={[]} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: ' key-1 ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(setApiKeysMock).toHaveBeenCalledWith('mistral', ['key-1'])
    })
  })

  it('rejects duplicate API keys', () => {
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'key-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(setApiKeysMock).not.toHaveBeenCalled()
    expect(window.toast.warning).toHaveBeenCalledWith('settings.provider.api.key.error.duplicate')
  })

  it('removes the last API key', async () => {
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(setApiKeysMock).toHaveBeenCalledWith('mistral', [])
    })
  })

  it('updates saved key rows from apiKeys props', () => {
    const { rerender } = render(
      <FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />
    )

    expect(screen.getByText('key-1')).toBeInTheDocument()

    rerender(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-2']} onSetApiKeys={setApiKeysMock} />)

    expect(screen.queryByText('key-1')).not.toBeInTheDocument()
    expect(screen.getByText('key-2')).toBeInTheDocument()
  })
})

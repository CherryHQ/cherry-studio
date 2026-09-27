import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as useFilesystemMcpModule from '@renderer/hooks/useFilesystemMcpBaseDir'

import { AgentWorkspaceFolderPickerButton } from '../AgentWorkspaceFolderPickerButton'

// Mock the hook
vi.mock('@renderer/hooks/useFilesystemMcpBaseDir')

// Mock window.api
global.window.api = {
  select: vi.fn()
} as any

describe('AgentWorkspaceFolderPickerButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when filesystem server is not available', () => {
    vi.mocked(useFilesystemMcpModule.useFilesystemMcpBaseDir).mockReturnValue({
      filesystemServer: null,
      baseDir: undefined,
      isLoading: false,
      updateBaseDir: vi.fn()
    } as any)

    const { container } = render(<AgentWorkspaceFolderPickerButton />)
    expect(container.firstChild).toBeNull()
  })

  it('should render button when filesystem server is available', () => {
    vi.mocked(useFilesystemMcpModule.useFilesystemMcpBaseDir).mockReturnValue({
      filesystemServer: { id: 'fs-1', name: 'filesystem' },
      baseDir: '/home/user/projects',
      isLoading: false,
      updateBaseDir: vi.fn()
    } as any)

    render(<AgentWorkspaceFolderPickerButton />)
    // The component should render at least one button
    const container = document.querySelector('button')
    expect(container).toBeInTheDocument()
  })
})

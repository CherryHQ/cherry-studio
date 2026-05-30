import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptSection from '../sections/PromptSection'

const { fetchGenerateMock, loggerErrorMock } = vi.hoisted(() => ({
  fetchGenerateMock: vi.fn(),
  loggerErrorMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchGenerate: fetchGenerateMock
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [14]
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    activeCmTheme: 'light'
  })
}))

vi.mock('@renderer/hooks/usePromptProcessor', () => ({
  usePromptProcessor: ({ prompt }: { prompt: string }) => prompt
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateTextTokens: (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('lucide-react', () => ({
  CircleHelp: (props: ComponentProps<'span'>) => <span {...props} />,
  Edit: () => <span />,
  Eye: () => <span />,
  HelpCircle: (props: ComponentProps<'span'>) => <span {...props} />,
  Loader2: () => <span />,
  Sparkles: () => <span />,
  Undo2: () => <span />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: (props: ComponentProps<'button'> & { loading?: boolean; variant?: string; size?: string }) => {
    const { children, ...buttonProps } = props
    delete buttonProps.loading
    delete buttonProps.variant
    delete buttonProps.size
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  CodeEditor: ({
    value,
    onChange,
    placeholder
  }: {
    value: string
    onChange?: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="prompt-editor"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
  Field: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  FieldContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldError: ({ errors }: { errors?: { message: string }[] }) => <div>{errors?.[0]?.message}</div>,
  FieldLabel: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

function PromptHarness({ initialPrompt = '', assistantName = 'Recipe Bot' }) {
  const [prompt, setPrompt] = useState(initialPrompt)

  return <PromptSection assistantName={assistantName} prompt={prompt} onChange={setPrompt} />
}

describe('PromptSection prompt generation', () => {
  beforeEach(() => {
    fetchGenerateMock.mockReset()
    loggerErrorMock.mockReset()
    fetchGenerateMock.mockResolvedValue('Generated prompt')
  })

  it('keeps only the system variable tooltip entry point on the prompt label', () => {
    render(<PromptHarness initialPrompt="Existing prompt" />)

    expect(screen.getByLabelText('library.config.prompt.variables_title')).toBeInTheDocument()
    expect(screen.queryByLabelText('library.config.prompt.hint')).not.toBeInTheDocument()
  })

  it('generates from the assistant name when the prompt is empty and can undo the generated prompt', async () => {
    const user = userEvent.setup()

    render(<PromptHarness />)

    await user.click(screen.getByRole('button', { name: 'library.config.prompt.generate' }))

    await waitFor(() => {
      expect(fetchGenerateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Recipe Bot'
        })
      )
    })
    expect(screen.getByDisplayValue('Generated prompt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.undo' }))

    expect(screen.getByDisplayValue('')).toBeInTheDocument()
  })
})

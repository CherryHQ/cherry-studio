import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as RendererConstantModule from '@renderer/config/constant'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FileProcessingSettings from '..'
import { PADDLEOCR_DEPLOYMENT_URL } from '../components/PaddleOCRDeploymentInfo'

const setPreferencesMock = vi.hoisted(() => vi.fn())
const setOverridesMock = vi.hoisted(() => vi.fn())
const listAvailableProcessorsMock = vi.hoisted(() => vi.fn())
const topViewShowMock = vi.hoisted(() => vi.fn())
const topViewHideMock = vi.hoisted(() => vi.fn())
const comboboxMockState = vi.hoisted(() => ({
  onChange: undefined as ((value: string | string[]) => void) | undefined,
  options: [] as Array<{ value: string; label: string }>,
  value: undefined as string | string[] | undefined
}))
const selectMockState = vi.hoisted(() => ({
  onValueChange: undefined as ((value: string) => void) | undefined,
  value: undefined as string | undefined
}))
const preferencesMock = vi.hoisted(() => ({
  defaultDocumentProcessor: null as string | null,
  defaultImageProcessor: null as string | null
}))
const overridesMock = vi.hoisted(() => ({ value: {} }))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/config/constant', async (importOriginal) => {
  const actual = await importOriginal<typeof RendererConstantModule>()

  return {
    ...actual,
    isMac: false,
    isWin: true
  }
})

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    languages: [
      { langCode: 'en-us', emoji: 'EN', value: 'English' },
      { langCode: 'zh-cn', emoji: 'ZH', value: 'Chinese' }
    ]
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [preferencesMock, setPreferencesMock],
  usePreference: () => [overridesMock.value, setOverridesMock]
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    show: topViewShowMock,
    hide: topViewHideMock
  }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()

  return {
    ...actual,
    Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
    Button: ({
      asChild,
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
      if (asChild) {
        return <>{children}</>
      }
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Combobox: ({
      emptyText,
      onChange,
      options,
      value
    }: React.HTMLAttributes<HTMLDivElement> & {
      emptyText?: string
      multiple?: boolean
      onChange?: (value: string | string[]) => void
      options?: Array<{ value: string; label: string }>
      value?: string | string[]
    }) => {
      comboboxMockState.onChange = onChange
      comboboxMockState.options = options ?? []
      comboboxMockState.value = value

      return (
        <div>
          {(options ?? []).length === 0 ? <span>{emptyText}</span> : null}
          {(options ?? []).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                const currentValue = Array.isArray(value) ? value : []
                const nextValue = currentValue.includes(option.value)
                  ? currentValue.filter((item) => item !== option.value)
                  : [...currentValue, option.value]

                onChange?.(nextValue)
              }}>
              {option.label} ({option.value})
            </button>
          ))}
        </div>
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
    MenuDivider: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
    MenuItem: ({
      active,
      icon,
      label,
      suffix,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      active?: boolean
      icon?: React.ReactNode
      label: string
      suffix?: React.ReactNode
    }) => {
      void icon

      return (
        <button type="button" aria-pressed={active} {...props}>
          {label}
          {suffix}
        </button>
      )
    },
    MenuList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Popover: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>,
    PopoverContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    PopoverTrigger: ({ children }: React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }) => <>{children}</>,
    Select: ({
      children,
      onValueChange,
      value
    }: React.HTMLAttributes<HTMLDivElement> & { onValueChange?: (value: string) => void; value?: string }) => {
      selectMockState.onValueChange = onValueChange
      selectMockState.value = value
      return <div data-value={value}>{children}</div>
    },
    SelectContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    SelectItem: ({ children, value, ...props }: React.HTMLAttributes<HTMLButtonElement> & { value: string }) => (
      <button type="button" {...props} onClick={() => selectMockState.onValueChange?.(value)}>
        {children}
      </button>
    ),
    SelectTrigger: (
      props: React.ButtonHTMLAttributes<HTMLButtonElement> & { selectedValue?: string; size?: string }
    ) => {
      const { children, selectedValue, size, ...buttonProps } = props
      void size

      return (
        <button type="button" {...buttonProps}>
          {children}
          {selectedValue ?? selectMockState.value}
        </button>
      )
    },
    SelectValue: () => null,
    Textarea: {
      Input: ({
        onValueChange,
        ...props
      }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { onValueChange?: (value: string) => void }) => (
        <textarea {...props} onChange={(event) => onValueChange?.(event.target.value)} />
      )
    },
    Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement> & { content?: React.ReactNode; delay?: number }) => (
      <>{children}</>
    )
  }
})

describe('FileProcessingSettings', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    preferencesMock.defaultDocumentProcessor = null
    preferencesMock.defaultImageProcessor = null
    overridesMock.value = {}
    comboboxMockState.onChange = undefined
    comboboxMockState.options = []
    comboboxMockState.value = undefined
    selectMockState.onValueChange = undefined
    selectMockState.value = undefined
    setPreferencesMock.mockReset()
    setPreferencesMock.mockResolvedValue(undefined)
    setOverridesMock.mockReset()
    setOverridesMock.mockResolvedValue(undefined)
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    loggerWarnSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})
    topViewShowMock.mockReset()
    topViewHideMock.mockReset()
    listAvailableProcessorsMock.mockReset()
    listAvailableProcessorsMock.mockResolvedValue({
      processorIds: ['system', 'tesseract', 'paddleocr', 'mineru', 'doc2x', 'mistral', 'open-mineru']
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fileProcessing: {
          listAvailableProcessors: listAvailableProcessorsMock
        }
      }
    })
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
  })

  it('sets the active image processor as the image-to-text default', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'settings.tool.file_processing.actions.set_as_default' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        defaultImageProcessor: 'system'
      })
    })
  })

  it('shows the provider detail header with a default badge and hides the default button', async () => {
    preferencesMock.defaultImageProcessor = 'system'

    render(<FileProcessingSettings />)

    expect((await screen.findAllByText('settings.tool.file_processing.processors.system.name')).length).toBeGreaterThan(
      0
    )
    expect(screen.queryByText('settings.tool.file_processing.processors.system.description')).not.toBeInTheDocument()
    expect(screen.getAllByText('common.default').length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'settings.tool.file_processing.actions.set_as_default' })
    ).not.toBeInTheDocument()
  })

  it('uses the Open MinerU label', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      await screen.findByRole('button', { name: /settings.tool.file_processing.processors.open_mineru.name/ })
    )

    expect(screen.getAllByText('settings.tool.file_processing.processors.open_mineru.name').length).toBeGreaterThan(0)
    expect(
      screen.queryByText('settings.tool.file_processing.processors.open_mineru.description')
    ).not.toBeInTheDocument()
  })

  it('shows OV OCR only when file processing reports it as available', async () => {
    render(<FileProcessingSettings />)

    expect(
      screen.queryByRole('button', { name: /settings.tool.file_processing.processors.ovocr.name/ })
    ).not.toBeInTheDocument()

    listAvailableProcessorsMock.mockResolvedValueOnce({
      processorIds: ['system', 'tesseract', 'paddleocr', 'mineru', 'doc2x', 'mistral', 'open-mineru', 'ovocr']
    })

    render(<FileProcessingSettings />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /settings.tool.file_processing.processors.ovocr.name/ })
      ).toBeInTheDocument()
    })
  })

  it('keeps OV OCR hidden and logs when available processor lookup fails', async () => {
    listAvailableProcessorsMock.mockRejectedValueOnce(new Error('IPC failed'))

    render(<FileProcessingSettings />)

    expect(
      screen.queryByRole('button', { name: /settings.tool.file_processing.processors.system.name/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /settings.tool.file_processing.processors.ovocr.name/ })
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to list available file processors',
        expect.objectContaining({ message: 'IPC failed' })
      )
    })
    expect(screen.getByText('settings.tool.file_processing.errors.load_processors_failed')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /settings.tool.file_processing.processors.ovocr.name/ })
    ).not.toBeInTheDocument()
  })

  it('stores API key input as file processing overrides', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ }))[0]
    )
    expect(screen.queryByText('settings.tool.file_processing.fields.model_id')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'), {
      target: { value: ' key-1, key-2 ' }
    })
    fireEvent.blur(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        mistral: {
          apiKeys: ['key-1', 'key-2']
        }
      })
    })
  })

  it('keeps API host drafts when another field save rerenders the same processor', async () => {
    const { rerender } = render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ }))[0]
    )

    const apiHostInput = screen.getByPlaceholderText('settings.provider.api_host')
    fireEvent.change(apiHostInput, {
      target: { value: 'https://draft.example.com' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'), {
      target: { value: 'key-1' }
    })
    fireEvent.blur(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        mistral: {
          apiKeys: ['key-1']
        }
      })
    })

    overridesMock.value = setOverridesMock.mock.calls.at(-1)?.[0] ?? {}
    rerender(<FileProcessingSettings />)

    expect(screen.getByPlaceholderText('settings.provider.api_host')).toHaveValue('https://draft.example.com')
  })

  it('reports API host save failures', async () => {
    const error = new Error('persist failed')
    setOverridesMock.mockRejectedValueOnce(error)
    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ }))[0]
    )
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_host'), {
      target: { value: 'https://draft.example.com' }
    })
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_host'))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.tool.file_processing.errors.save_failed')
    })
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to save API host', error)
  })

  it('trims API host before persisting', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ }))[0]
    )

    const apiHostInput = screen.getByPlaceholderText('settings.provider.api_host')
    fireEvent.change(apiHostInput, {
      target: { value: '  https://draft.example.com  ' }
    })
    fireEvent.blur(apiHostInput)

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        mistral: {
          capabilities: {
            image_to_text: {
              apiHost: 'https://draft.example.com'
            }
          }
        }
      })
    })
    expect(apiHostInput).toHaveValue('https://draft.example.com')
  })

  it('rejects invalid API host before persisting', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ }))[0]
    )

    const apiHostInput = screen.getByPlaceholderText('settings.provider.api_host')
    fireEvent.change(apiHostInput, {
      target: { value: '  not-a-url  ' }
    })
    fireEvent.blur(apiHostInput)

    await waitFor(() => {
      expect(window.toast.warning).toHaveBeenCalledWith('settings.tool.file_processing.errors.invalid_api_host')
    })
    expect(setOverridesMock).not.toHaveBeenCalled()
    expect(apiHostInput).toHaveValue('not-a-url')
  })

  it('opens the file processing API key list popup from the API key field', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ }))[0]
    )
    fireEvent.change(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'), {
      target: { value: ' key-1, key-2 ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api.key.list.open' }))

    await waitFor(() => {
      expect(topViewShowMock).toHaveBeenCalled()
    })

    const popup = topViewShowMock.mock.calls[0][0]
    expect(popup.props.processorId).toBe('mistral')
    expect(popup.props.apiKeys).toEqual(['key-1', 'key-2'])
    expect(popup.props.title).toBe(
      'settings.tool.file_processing.processors.mistral.name settings.provider.api.key.list.title'
    )
  })

  it('stores System OCR language options on Windows', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /English \(en-us\)/ }))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        system: {
          options: {
            langs: ['en-us']
          }
        }
      })
    })
  })

  it('shows PaddleOCR deployment guidance with the deployment link', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ }))[0]
    )

    const apiKeyLabel = screen.getByText('settings.tool.file_processing.fields.api_key')
    const modelSection = screen.getByText('settings.tool.file_processing.sections.model_parameters')
    const deploymentDescription = screen.getByText(
      'settings.tool.file_processing.processors.paddleocr.deployment.description'
    )

    expect(deploymentDescription).toBeInTheDocument()
    expect(apiKeyLabel.compareDocumentPosition(modelSection)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(modelSection.compareDocumentPosition(deploymentDescription)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      screen.getByRole('link', { name: /settings.tool.file_processing.processors.paddleocr.deployment.docs/ })
    ).toHaveAttribute('href', PADDLEOCR_DEPLOYMENT_URL)
  })

  it('stores PaddleOCR model changes per feature', async () => {
    const { rerender } = render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ }))[0]
    )
    fireEvent.click(screen.getByRole('button', { name: 'PP-OCRv5' }))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        paddleocr: {
          capabilities: {
            image_to_text: {
              modelId: 'PP-OCRv5'
            }
          }
        }
      })
    })

    overridesMock.value = setOverridesMock.mock.calls.at(-1)?.[0] ?? {}
    rerender(<FileProcessingSettings />)

    fireEvent.click(
      screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ })[1]
    )
    fireEvent.click(screen.getByRole('button', { name: 'PP-StructureV3' }))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        paddleocr: {
          capabilities: {
            image_to_text: {
              modelId: 'PP-OCRv5'
            },
            document_to_markdown: {
              modelId: 'PP-StructureV3'
            }
          }
        }
      })
    })
  })

  it('shows PaddleOCR OCR and document models from their own feature overrides', async () => {
    overridesMock.value = {
      paddleocr: {
        capabilities: {
          document_to_markdown: {
            modelId: 'PP-StructureV3'
          },
          image_to_text: {
            modelId: 'PP-OCRv5'
          }
        }
      }
    }

    render(<FileProcessingSettings />)

    fireEvent.click(
      (await screen.findAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ }))[0]
    )
    expect(
      screen.getByRole('button', { name: 'settings.tool.file_processing.processors.paddleocr.fields.parse_model' })
    ).toHaveTextContent('PP-OCRv5')

    fireEvent.click(
      screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ })[1]
    )
    expect(
      screen.getByRole('button', { name: 'settings.tool.file_processing.processors.paddleocr.fields.parse_model' })
    ).toHaveTextContent('PP-StructureV3')
  })

  it('manages Tesseract language packs with the settings combobox', async () => {
    overridesMock.value = {
      tesseract: {
        options: {
          langs: ['eng']
        }
      }
    }

    render(<FileProcessingSettings />)

    fireEvent.click(
      await screen.findByRole('button', { name: /settings.tool.file_processing.processors.tesseract.name/ })
    )

    expect(screen.getByRole('button', { name: /English \(eng\)/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Chinese \(chi_sim\)/ }))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        tesseract: {
          options: {
            langs: ['eng', 'chi_sim']
          }
        }
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /English \(eng\)/ }))

    await waitFor(() => {
      expect(setOverridesMock).toHaveBeenCalledWith({
        tesseract: {
          options: {
            langs: []
          }
        }
      })
    })
  })
})

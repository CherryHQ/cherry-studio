import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FileProcessingSettings from '..'
import { PADDLEOCR_DEPLOYMENT_URL } from '../components/PaddleOCRDeploymentInfo'

const setPreferencesMock = vi.hoisted(() => vi.fn())
const listAvailableProcessorsMock = vi.hoisted(() => vi.fn())
const topViewShowMock = vi.hoisted(() => vi.fn())
const topViewHideMock = vi.hoisted(() => vi.fn())
const selectMockState = vi.hoisted(() => ({
  onValueChange: undefined as ((value: string) => void) | undefined,
  value: undefined as string | undefined
}))
const preferencesMock = vi.hoisted(() => ({
  defaultDocumentProcessor: null as string | null,
  defaultImageProcessor: null as string | null,
  overrides: {}
}))

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

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  isWin: true
}))

vi.mock('@renderer/hooks/useTranslate', () => ({
  default: () => ({
    translateLanguages: [
      { langCode: 'en-us', emoji: 'EN', label: () => 'English' },
      { langCode: 'zh-cn', emoji: 'ZH', label: () => 'Chinese' }
    ]
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [preferencesMock, setPreferencesMock]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
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

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
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
  Combobox: () => <div />,
  Command: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CommandEmpty: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CommandGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
    ...props
  }: React.HTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) => (
    <button type="button" {...props} onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
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
  SelectTrigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { selectedValue?: string; size?: string }) => {
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
}))

describe('FileProcessingSettings', () => {
  beforeEach(() => {
    preferencesMock.defaultDocumentProcessor = null
    preferencesMock.defaultImageProcessor = null
    preferencesMock.overrides = {}
    selectMockState.onValueChange = undefined
    selectMockState.value = undefined
    setPreferencesMock.mockReset()
    setPreferencesMock.mockResolvedValue(undefined)
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

    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.file_processing.actions.set_as_default' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        defaultImageProcessor: 'system'
      })
    })
  })

  it('shows the provider detail header with a default badge and hides the default button', () => {
    preferencesMock.defaultImageProcessor = 'system'

    render(<FileProcessingSettings />)

    expect(screen.getByText('settings.tool.file_processing.processors.system.description')).toBeInTheDocument()
    expect(screen.getAllByText('common.default').length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'settings.tool.file_processing.actions.set_as_default' })
    ).not.toBeInTheDocument()
  })

  it('uses the Open MinerU description', () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.tool.file_processing.processors.open_mineru.name/ }))

    expect(screen.getByText('settings.tool.file_processing.processors.open_mineru.description')).toBeInTheDocument()
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

  it('stores API key input as file processing overrides', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ })[0])
    expect(screen.queryByText('settings.tool.file_processing.fields.model_id')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'), {
      target: { value: ' key-1, key-2 ' }
    })
    fireEvent.blur(screen.getByPlaceholderText('settings.tool.file_processing.fields.api_keys_placeholder'))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {
          mistral: {
            apiKeys: ['key-1', 'key-2']
          }
        }
      })
    })
  })

  it('opens the file processing API key list popup from the API key field', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.mistral.name/ })[0])
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

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.tool.file_processing.processors.tesseract.actions.add_language' })
    )
    fireEvent.click(screen.getByRole('button', { name: /English \(en-us\)/ }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {
          system: {
            options: {
              langs: ['en-us']
            }
          }
        }
      })
    })
  })

  it('shows PaddleOCR deployment guidance with the deployment link', () => {
    render(<FileProcessingSettings />)

    fireEvent.click(
      screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ })[0]
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
    render(<FileProcessingSettings />)

    fireEvent.click(
      screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ })[0]
    )
    fireEvent.click(screen.getByRole('button', { name: 'PP-OCRv5' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {
          paddleocr: {
            capabilities: {
              image_to_text: {
                modelId: 'PP-OCRv5'
              }
            }
          }
        }
      })
    })

    fireEvent.click(
      screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ })[1]
    )
    fireEvent.click(screen.getByRole('button', { name: 'PP-StructureV3' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {
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
        }
      })
    })
  })

  it('shows PaddleOCR OCR and document models from their own feature overrides', () => {
    preferencesMock.overrides = {
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
      screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr.name/ })[0]
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

  it('manages Tesseract language packs with chips', async () => {
    preferencesMock.overrides = {
      tesseract: {
        options: {
          langs: ['eng']
        }
      }
    }

    render(<FileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.tool.file_processing.processors.tesseract.name/ }))

    expect(screen.getAllByText('English').length).toBeGreaterThan(0)
    expect(screen.getAllByText('(eng)').length).toBeGreaterThan(0)

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.tool.file_processing.processors.tesseract.actions.add_language' })
    )
    fireEvent.click(screen.getByRole('button', { name: /Chinese \(chi_sim\)/ }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {
          tesseract: {
            options: {
              langs: ['eng', 'chi_sim']
            }
          }
        }
      })
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.tool.file_processing.processors.tesseract.actions.remove_language' })
    )

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {}
      })
    })
  })
})

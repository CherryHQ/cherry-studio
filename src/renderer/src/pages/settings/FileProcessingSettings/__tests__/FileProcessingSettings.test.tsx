import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FileProcessingSettings from '..'
import { PADDLEOCR_DEPLOYMENT_URL } from '../components/PaddleOCRDeploymentInfo'

const setPreferencesMock = vi.hoisted(() => vi.fn())
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
  }
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
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })
  })

  it('sets the active image processor as the image-to-text default', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.set_as_default' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        defaultImageProcessor: 'system'
      })
    })
  })

  it('shows the provider detail header with a default badge and hides the default button', () => {
    preferencesMock.defaultImageProcessor = 'system'

    render(<FileProcessingSettings />)

    expect(screen.getByText('settings.tool.file_processing.provider_descriptions.system')).toBeInTheDocument()
    expect(screen.getAllByText('common.default').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'settings.tool.websearch.set_as_default' })).not.toBeInTheDocument()
  })

  it('uses the MinerU description for Open MinerU', () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getByRole('button', { name: /settings.tool.file_processing.processors.open_mineru/ }))

    expect(screen.getByText('settings.tool.file_processing.provider_descriptions.mineru')).toBeInTheDocument()
  })

  it('stores API key input as file processing overrides', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.mistral/ })[0])
    expect(screen.queryByText('settings.tool.file_processing.model_id')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('settings.tool.file_processing.placeholders.api_keys'), {
      target: { value: ' key-1, key-2 ' }
    })
    fireEvent.blur(screen.getByPlaceholderText('settings.tool.file_processing.placeholders.api_keys'))

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

  it('shows PaddleOCR deployment guidance with the deployment link', () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr/ })[0])

    const apiKeyLabel = screen.getByText('settings.tool.file_processing.api_key_label')
    const modelSection = screen.getByText('settings.tool.file_processing.sections.model_parameters')
    const deploymentDescription = screen.getByText('settings.tool.file_processing.paddleocr.deployment_description')

    expect(deploymentDescription).toBeInTheDocument()
    expect(apiKeyLabel.compareDocumentPosition(modelSection)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(modelSection.compareDocumentPosition(deploymentDescription)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      screen.getByRole('link', { name: /settings.tool.file_processing.paddleocr.docker_deployment_docs/ })
    ).toHaveAttribute('href', PADDLEOCR_DEPLOYMENT_URL)
  })

  it('stores PaddleOCR model changes per feature', async () => {
    render(<FileProcessingSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr/ })[0])
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

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr/ })[1])
    fireEvent.click(screen.getByRole('button', { name: 'PP-StructureV3' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {
          paddleocr: {
            capabilities: {
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

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr/ })[0])
    expect(
      screen.getByRole('button', { name: 'settings.tool.file_processing.paddleocr.parse_model' })
    ).toHaveTextContent('PP-OCRv5')

    fireEvent.click(screen.getAllByRole('button', { name: /settings.tool.file_processing.processors.paddleocr/ })[1])
    expect(
      screen.getByRole('button', { name: 'settings.tool.file_processing.paddleocr.parse_model' })
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

    fireEvent.click(screen.getByRole('button', { name: /settings.tool.file_processing.processors.tesseract/ }))

    expect(screen.getAllByText('English').length).toBeGreaterThan(0)
    expect(screen.getAllByText('(eng)').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.file_processing.tesseract.add_language' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.file_processing.tesseract.remove_language' }))

    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({
        overrides: {}
      })
    })
  })
})

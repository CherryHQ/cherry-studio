import { CURRENCY, type Model } from '@shared/data/types/model'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import EditModelDrawer from '../EditModelDrawer'

const useProviderMock = vi.fn()
const updateModelMock = vi.fn()

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest }, useIpcOn: vi.fn() }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    ...actual,
    Button: ({ children, onClick, type = 'button', ...props }: any) => (
      <button type={type} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
        {String(checked)}
      </button>
    ),
    Tooltip: ({ children, content }: any) => <span aria-label={content}>{children}</span>,
    WarnTooltip: () => <span>warn</span>,
    // Radix's select cannot be opened in jsdom, so the option list is flattened
    // into buttons to make the currency switch clickable.
    Select: ({ children, onValueChange }: any) => <SelectContext value={{ onValueChange }}>{children}</SelectContext>,
    SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => {
      const { onValueChange } = React.use(SelectContext)
      return (
        <button type="button" aria-label={`currency-${value}`} onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    }
  }
})

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelMutations: () => ({
    updateModel: (...args: any[]) => updateModelMock(...args)
  })
}))

vi.mock('@renderer/components/tags/Model', () => ({
  VisionTag: () => <span>vision</span>,
  WebSearchTag: () => <span>web_search</span>,
  ReasoningTag: () => <span>reasoning</span>,
  ToolsCallingTag: () => <span>function_calling</span>,
  RerankerTag: () => <span>rerank</span>,
  EmbeddingTag: () => <span>embedding</span>
}))

vi.mock('@renderer/components/icons/CopyIcon', () => ({
  default: () => <span>copy-icon</span>
}))

vi.mock('../../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, children }: any) =>
    open ? (
      <div data-testid="provider-settings-drawer">
        <div>{title}</div>
        {children}
      </div>
    ) : null
}))

function makePricingModel(cacheReadPrice?: number): Model {
  return {
    id: 'openai::claude-4-sonnet',
    providerId: 'openai',
    name: 'claude-4-sonnet',
    group: 'Anthropic',
    capabilities: [],
    supportsStreaming: true,
    pricing: {
      input: { perMillionTokens: 3, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      ...(cacheReadPrice !== undefined
        ? { cacheRead: { perMillionTokens: cacheReadPrice, currency: CURRENCY.USD } }
        : {}),
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
    }
  } as unknown as Model
}

const modelWithFullPricing = makePricingModel(0.3)

describe('EditModelDrawer pricing currency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequest.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
  })

  it('keeps every pricing tier untouched when an unrelated field is edited', async () => {
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={modelWithFullPricing} />)

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, { target: { value: 'Claude 4 Sonnet Renamed' } })
      fireEvent.blur(modelName)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        name: 'Claude 4 Sonnet Renamed',
        pricing: {
          input: { perMillionTokens: 3, currency: CURRENCY.USD },
          output: { perMillionTokens: 15, currency: CURRENCY.USD },
          cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.USD },
          cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
        }
      })
    )
  })

  it('preserves an explicit zero cache-read rate when an unrelated field is edited', async () => {
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makePricingModel(0)} />)

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, { target: { value: 'Claude 4 Sonnet Renamed' } })
      fireEvent.blur(modelName)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        pricing: {
          input: { perMillionTokens: 3, currency: CURRENCY.USD },
          output: { perMillionTokens: 15, currency: CURRENCY.USD },
          cacheRead: { perMillionTokens: 0, currency: CURRENCY.USD },
          cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
        }
      })
    )
  })

  it('keeps an absent cache-read rate absent when an unrelated field is edited', async () => {
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makePricingModel()} />)

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, { target: { value: 'Claude 4 Sonnet Renamed' } })
      fireEvent.blur(modelName)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        pricing: {
          input: { perMillionTokens: 3, currency: CURRENCY.USD },
          output: { perMillionTokens: 15, currency: CURRENCY.USD },
          cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
        }
      })
    )
  })

  it('carries per-image, per-minute, and threshold pricing through an unrelated edit', async () => {
    const model = {
      ...modelWithFullPricing,
      pricing: {
        ...modelWithFullPricing.pricing,
        perImage: { price: 0.04, unit: 'image' },
        perMinute: { price: 0.006 },
        thresholds: [{ aboveInputTokens: 512_000, input: 6, output: 30, cacheRead: 0.6 }]
      }
    } as unknown as Model

    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, { target: { value: 'Claude 4 Sonnet Renamed' } })
      fireEvent.blur(modelName)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        pricing: {
          input: { perMillionTokens: 3, currency: CURRENCY.USD },
          output: { perMillionTokens: 15, currency: CURRENCY.USD },
          cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.USD },
          cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD },
          perImage: { price: 0.04, unit: 'image' },
          perMinute: { price: 0.006 },
          thresholds: [{ aboveInputTokens: 512_000, input: 6, output: 30, cacheRead: 0.6 }]
        }
      })
    )
  })

  it('moves every pricing tier to the newly selected currency', async () => {
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={modelWithFullPricing} />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('currency-¥'))
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        pricing: {
          input: { perMillionTokens: 3, currency: CURRENCY.CNY },
          output: { perMillionTokens: 15, currency: CURRENCY.CNY },
          cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.CNY },
          cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.CNY }
        }
      })
    )
  })
})

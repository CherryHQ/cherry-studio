import { CURRENCY, type Model } from '@shared/data/types/model'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      t: (key: string, options?: Record<string, string | number>) => {
        if (key === 'models.price.field_for_tier') {
          return `${options?.field}, tier ${options?.index}`
        }
        if (key === 'models.price.remove_tier') {
          return `Remove pricing tier ${options?.index}`
        }
        if (key === 'models.price.tier') {
          return `Tier ${options?.index}`
        }
        if (key === 'models.price.tier_from') {
          return `From ${options?.boundary} input tokens (inclusive)`
        }
        return key
      }
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

interface PricingModelOptions {
  inputPrice?: number | null
  outputPrice?: number | null
  cacheReadPrice?: number
  cacheWritePrice?: number | null
  includeHiddenRates?: boolean
  inputTokenTiers?: NonNullable<NonNullable<Model['pricing']>['inputTokenTiers']>
}

function makePricingModel({
  inputPrice = 3,
  outputPrice = 15,
  cacheReadPrice,
  cacheWritePrice = 3.75,
  includeHiddenRates = false,
  inputTokenTiers
}: PricingModelOptions = {}): Model {
  return {
    id: 'openai::claude-4-sonnet',
    providerId: 'openai',
    name: 'claude-4-sonnet',
    group: 'Anthropic',
    capabilities: [],
    supportsStreaming: true,
    pricing: {
      input: { perMillionTokens: inputPrice, currency: CURRENCY.USD },
      output: { perMillionTokens: outputPrice, currency: CURRENCY.USD },
      ...(cacheReadPrice !== undefined
        ? { cacheRead: { perMillionTokens: cacheReadPrice, currency: CURRENCY.USD } }
        : {}),
      ...(cacheWritePrice !== null
        ? { cacheWrite: { perMillionTokens: cacheWritePrice, currency: CURRENCY.USD } }
        : {}),
      ...(inputTokenTiers ? { inputTokenTiers } : {}),
      ...(includeHiddenRates
        ? {
            perImage: { price: 0.04, unit: 'image' as const },
            perMinute: { price: 0.2 }
          }
        : {})
    }
  } as unknown as Model
}

function makeTieredPricingModel(): Model {
  return makePricingModel({
    cacheReadPrice: 0.3,
    includeHiddenRates: true,
    inputTokenTiers: [
      {
        minInputTokens: 100_000,
        input: { perMillionTokens: 2.5, currency: CURRENCY.USD },
        output: { perMillionTokens: 12, currency: CURRENCY.USD },
        cacheRead: { perMillionTokens: 0.2, currency: CURRENCY.USD },
        cacheWrite: { perMillionTokens: 0, currency: CURRENCY.USD }
      }
    ]
  })
}

const modelWithFullPricing = makePricingModel({ cacheReadPrice: 0.3 })

describe('EditModelDrawer pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequest.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
  })

  it('keeps every pricing tier untouched when an unrelated field is edited', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    const modelName = screen.getByLabelText('settings.models.add.model_name.label')
    await user.clear(modelName)
    await user.type(modelName, 'Claude 4 Sonnet Renamed')
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(expect.objectContaining({ name: 'Claude 4 Sonnet Renamed' }))
    expect(updateModelMock.mock.calls[0][2]).not.toHaveProperty('pricing')
  })

  it('keeps a queued pricing save when a later unrelated field is edited', async () => {
    const user = userEvent.setup()
    let resolveFirstSave!: () => void
    updateModelMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSave = resolve
          })
      )
      .mockResolvedValue(undefined)
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    const modelName = screen.getByLabelText('settings.models.add.model_name.label')
    await user.clear(modelName)
    await user.type(modelName, 'Claude 4 Sonnet Renamed')
    await user.tab()
    await user.click(screen.getByLabelText('currency-¥'))
    await user.click(screen.getByRole('switch', { name: 'settings.models.add.supported_text_delta.label' }))

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    resolveFirstSave()

    await waitFor(() => expect(updateModelMock).toHaveBeenCalledTimes(2))
    expect(updateModelMock.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        supportsStreaming: false,
        pricing: expect.objectContaining({
          input: { perMillionTokens: 3, currency: CURRENCY.CNY },
          inputTokenTiers: expect.arrayContaining([
            expect.objectContaining({ input: { perMillionTokens: 2.5, currency: CURRENCY.CNY } })
          ])
        })
      })
    )
  })

  it('rejects non-numeric characters and a second decimal point in price inputs', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    const cacheReadPrice = screen.getByLabelText('models.price.cache_read')
    await user.clear(cacheReadPrice)
    await user.type(cacheReadPrice, '1a.2.5')

    expect(cacheReadPrice).toHaveValue('1.25')
  })

  it('rejects non-digits in a tier boundary input', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    const minInputTokens = screen.getByLabelText(/models\.price\.min_input_tokens/)
    await user.clear(minInputTokens)
    await user.type(minInputTokens, '12a.8')

    expect(minInputTokens).toHaveValue('128')
  })

  it('preserves explicit zero cache rates and unedited pricing fields when a price is saved', async () => {
    const user = userEvent.setup()
    const model = makeTieredPricingModel()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    const cacheReadPrice = screen.getByLabelText('models.price.cache_read')
    await user.clear(cacheReadPrice)
    await user.type(cacheReadPrice, '0')
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: 3, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      cacheRead: { perMillionTokens: 0, currency: CURRENCY.USD },
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD },
      inputTokenTiers: model.pricing?.inputTokenTiers,
      perImage: { price: 0.04, unit: 'image' },
      perMinute: { price: 0.2 }
    })
  })

  it('keeps blank cache prices absent when another price is saved', async () => {
    const user = userEvent.setup()
    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={makePricingModel({ cacheWritePrice: null, includeHiddenRates: true })}
      />
    )

    const inputPrice = screen.getByLabelText('models.price.input')
    await user.clear(inputPrice)
    await user.type(inputPrice, '4')
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: 4, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      perImage: { price: 0.04, unit: 'image' },
      perMinute: { price: 0.2 }
    })
  })

  it('saves a blanked price as unknown instead of free', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makePricingModel()} />)

    await user.clear(screen.getByLabelText('models.price.input'))
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: null, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
    })
  })

  it('shows an unpriced model as blank rather than 0', () => {
    const model = { ...makePricingModel(), pricing: undefined } as unknown as Model
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    expect(screen.getByLabelText('models.price.input')).toHaveValue('')
    expect(screen.getByLabelText('models.price.output')).toHaveValue('')
  })

  it('renders an explicitly free rate as 0 while an unknown rate stays blank', () => {
    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={makePricingModel({ inputPrice: 0, outputPrice: null })}
      />
    )

    expect(screen.getByLabelText('models.price.input')).toHaveValue('0')
    expect(screen.getByLabelText('models.price.output')).toHaveValue('')
  })

  it('moves every pricing tier to the newly selected currency', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    await user.click(screen.getByLabelText('currency-¥'))

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: 3, currency: CURRENCY.CNY },
      output: { perMillionTokens: 15, currency: CURRENCY.CNY },
      cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.CNY },
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.CNY },
      inputTokenTiers: [
        {
          minInputTokens: 100_000,
          input: { perMillionTokens: 2.5, currency: CURRENCY.CNY },
          output: { perMillionTokens: 12, currency: CURRENCY.CNY },
          cacheRead: { perMillionTokens: 0.2, currency: CURRENCY.CNY },
          cacheWrite: { perMillionTokens: 0, currency: CURRENCY.CNY }
        }
      ],
      perImage: { price: 0.04, unit: 'image' },
      perMinute: { price: 0.2 }
    })
  })

  it('waits for a valid inclusive boundary before saving a new tier', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={modelWithFullPricing} />)

    await user.click(screen.getByRole('button', { name: 'models.price.add_tier' }))
    expect(updateModelMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('models.price.min_input_tokens, tier 2'), '100000')
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: 3, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.USD },
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD },
      inputTokenTiers: [
        {
          minInputTokens: 100_000,
          input: { perMillionTokens: 3, currency: CURRENCY.USD },
          output: { perMillionTokens: 15, currency: CURRENCY.USD },
          cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.USD },
          cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
        }
      ]
    })
  })

  it('saves valid base pricing while a new trailing tier is incomplete', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={modelWithFullPricing} />)

    await user.click(screen.getByRole('button', { name: 'models.price.add_tier' }))
    const inputPrice = screen.getByLabelText('models.price.input')
    await user.clear(inputPrice)
    await user.type(inputPrice, '4')
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: 4, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.USD },
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD }
    })
  })

  it('does not save an additional tier with a duplicate boundary', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    await user.click(screen.getByRole('button', { name: 'models.price.add_tier' }))
    await user.type(screen.getByLabelText('models.price.min_input_tokens, tier 3'), '100000')
    await user.tab()

    expect(screen.getByRole('alert')).toHaveTextContent('models.price.validation_min_input_tokens_order')
    expect(updateModelMock).not.toHaveBeenCalled()
  })

  it('saves a valid tier removal while preserving unedited pricing fields', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    await user.click(screen.getByRole('button', { name: 'Remove pricing tier 2' }))

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2].pricing).toEqual({
      input: { perMillionTokens: 3, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
      cacheRead: { perMillionTokens: 0.3, currency: CURRENCY.USD },
      cacheWrite: { perMillionTokens: 3.75, currency: CURRENCY.USD },
      perImage: { price: 0.04, unit: 'image' },
      perMinute: { price: 0.2 }
    })
  })
})

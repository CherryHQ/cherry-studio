import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CURRENCY, type Model } from '@shared/data/types/model'

import EditModelDrawer from '../EditModelDrawer'
import { buildModelImagePricing } from '../modelPricing'

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
  cacheReadPrice?: number
  cacheWritePrice?: number | null
  includeHiddenRates?: boolean
  inputTokenTiers?: NonNullable<NonNullable<Model['pricing']>['inputTokenTiers']>
}

function makePricingModel({
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
      input: { perMillionTokens: 3, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD },
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

describe('EditModelDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequest.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
  })

  it('saves an image rate without inventing token prices and retains it when editing tokens', async () => {
    const user = userEvent.setup()
    const model = { ...modelWithFullPricing, pricing: undefined }
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    await user.click(screen.getByRole('button', { name: 'currency-image' }))
    await user.type(screen.getByLabelText('models.price.per_image'), '0.04')
    await user.tab()

    await waitFor(() => {
      expect(updateModelMock.mock.lastCall?.[2].pricing).toEqual({
        input: { perMillionTokens: null, currency: CURRENCY.USD },
        output: { perMillionTokens: null, currency: CURRENCY.USD },
        perImage: { price: 0.04, unit: 'image' }
      })
    })

    await user.click(screen.getByRole('button', { name: 'currency-token' }))
    await user.clear(screen.getByLabelText('models.price.input'))
    await user.type(screen.getByLabelText('models.price.input'), '2')
    await user.tab()
    await waitFor(() => {
      expect(updateModelMock.mock.lastCall?.[2].pricing).toMatchObject({
        input: { perMillionTokens: 2, currency: CURRENCY.USD },
        perImage: { price: 0.04, unit: 'image' }
      })
    })
  })

  it.each([
    { scenario: 'new', initial: undefined, value: '0.08', expected: 0.08 },
    { scenario: 'updated', initial: 0.02, value: '0.08', expected: 0.08 },
    { scenario: 'free', initial: 0.02, value: '0', expected: 0 },
    { scenario: 'cleared', initial: 0.02, value: '', expected: undefined }
  ])('retains the $scenario image rate across More settings remounts', async ({ initial, value, expected }) => {
    const user = userEvent.setup()
    const model = makePricingModel()
    if (initial !== undefined) model.pricing!.perImage = { price: initial, unit: 'image' }
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    await user.click(screen.getByRole('button', { name: 'currency-image' }))
    const imagePrice = screen.getByLabelText('models.price.per_image')
    await user.clear(imagePrice)
    if (value) await user.type(imagePrice, value)
    await user.tab()
    await waitFor(() => expect(updateModelMock.mock.lastCall?.[2].pricing.perImage?.price).toBe(expected))

    await user.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))
    expect(screen.queryByLabelText('models.price.per_image')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))
    await user.click(screen.getByRole('button', { name: 'currency-token' }))
    await user.clear(screen.getByLabelText('models.price.input'))
    await user.type(screen.getByLabelText('models.price.input'), '4')
    await user.tab()

    await waitFor(() => {
      const saved = updateModelMock.mock.lastCall?.[2].pricing
      expect(saved?.input.perMillionTokens).toBe(4)
      expect(saved?.perImage).toEqual(expected === undefined ? undefined : { price: expected, unit: 'image' })
    })
  })

  it('resets the retained price when selecting a different model', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makePricingModel()} />
    )
    await user.click(screen.getByRole('button', { name: 'currency-image' }))
    await user.type(screen.getByLabelText('models.price.per_image'), '0.08')
    await user.tab()
    const nextModel = { ...makePricingModel(), id: 'openai::second-model' as Model['id'] }
    rerender(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={nextModel} />)
    expect(screen.getByLabelText('models.price.input')).toHaveValue('3')
    await user.clear(screen.getByLabelText('models.price.input'))
    await user.type(screen.getByLabelText('models.price.input'), '4')
    await user.tab()
    await waitFor(() => {
      expect(updateModelMock.mock.lastCall?.slice(0, 2)).toEqual(['openai', 'second-model'])
      expect(updateModelMock.mock.lastCall?.[2].pricing).not.toHaveProperty('perImage')
    })
  })

  it('preserves token drafts and stored rates while saving and reopening an image price', async () => {
    const user = userEvent.setup()
    const model = makeTieredPricingModel()
    const { unmount } = render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)
    expect(screen.getByLabelText('models.price.per_image')).toHaveValue('0.04')
    await user.click(screen.getByRole('button', { name: 'currency-token' }))
    await user.clear(screen.getByLabelText(/models\.price\.min_input_tokens/))
    await user.type(screen.getByLabelText(/models\.price\.min_input_tokens/), '0')
    await user.click(screen.getByRole('button', { name: 'currency-image' }))
    await user.clear(screen.getByLabelText('models.price.per_image'))
    await user.type(screen.getByLabelText('models.price.per_image'), '0.08')
    await user.tab()
    await waitFor(() => {
      expect(updateModelMock.mock.lastCall?.[2].pricing).toEqual({
        ...model.pricing,
        perImage: { price: 0.08, unit: 'image' }
      })
    })
    const savedPricing = updateModelMock.mock.lastCall?.[2].pricing
    await user.click(screen.getByRole('button', { name: 'currency-token' }))
    expect(screen.getByLabelText(/models\.price\.min_input_tokens/)).toHaveValue('0')
    unmount()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={{ ...model, pricing: savedPricing }} />)
    expect(screen.getByLabelText('models.price.per_image')).toHaveValue('0.08')
  })

  it('rejects negative image prices and distinguishes free images from an unset rate', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)
    const field = screen.getByLabelText('models.price.per_image')
    await user.clear(field)
    await user.type(field, '-1')
    await user.tab()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('models.price.validation_price')
    expect(updateModelMock).not.toHaveBeenCalled()
    await user.clear(field)
    await user.type(field, '0')
    await user.tab()
    await waitFor(() =>
      expect(updateModelMock.mock.lastCall?.[2].pricing.perImage).toEqual({ price: 0, unit: 'image' })
    )
    await user.clear(field)
    await user.tab()
    await waitFor(() => expect(updateModelMock.mock.lastCall?.[2].pricing).not.toHaveProperty('perImage'))
    expect(field).toHaveValue('')
  })

  it('keeps pixel prices when changing currency until an image rate is explicitly entered', async () => {
    const user = userEvent.setup()
    const model = makeTieredPricingModel()
    model.pricing!.perImage = { price: 0.000001, unit: 'pixel' }
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)
    await user.click(screen.getByRole('button', { name: 'currency-image' }))
    const field = screen.getByLabelText('models.price.per_image')
    expect(field).toHaveValue('')
    await user.click(field)
    await user.tab()
    expect(updateModelMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'currency-¥' }))
    await waitFor(() =>
      expect(updateModelMock.mock.lastCall?.[2].pricing).toMatchObject({
        perImage: { price: 0.000001, unit: 'pixel' },
        input: { perMillionTokens: 3, currency: CURRENCY.CNY },
        inputTokenTiers: [{ minInputTokens: 100_000, output: { perMillionTokens: 12, currency: CURRENCY.CNY } }]
      })
    )
    await user.type(field, '0.05')
    await user.tab()
    await waitFor(() =>
      expect(updateModelMock.mock.lastCall?.[2].pricing.perImage).toEqual({ price: 0.05, unit: 'image' })
    )
  })

  it.each(['NaN', 'Infinity', '-0.01'])('rejects invalid image rate %s without changing stored prices', (value) => {
    const pricing = makeTieredPricingModel().pricing
    expect(buildModelImagePricing(pricing, '$', value)).toEqual({ error: 'invalidPrice' })
    expect(pricing?.perImage).toEqual({ price: 0.04, unit: 'image' })
  })

  it('autosaves the settled positive minimum instead of an invalid zero', async () => {
    const user = userEvent.setup()
    const model = {
      ...makePricingModel(),
      contextWindow: 128_000,
      maxInputTokens: 64_000,
      maxOutputTokens: 8_000
    }
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    const contextWindow = screen.getByLabelText('settings.models.add.context_window.label')
    expect(contextWindow).toHaveValue('128000')

    await user.clear(contextWindow)
    await user.type(contextWindow, '0')
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(expect.objectContaining({ contextWindow: 1 }))
    expect(updateModelMock.mock.calls[0][2]).not.toHaveProperty('maxInputTokens')
    expect(updateModelMock.mock.calls[0][2]).not.toHaveProperty('maxOutputTokens')
  })

  it('maps a cleared token limit to null without changing the other numeric limits', async () => {
    const user = userEvent.setup()
    const model = {
      ...makePricingModel(),
      contextWindow: 128_000,
      maxInputTokens: 64_000,
      maxOutputTokens: 8_000
    }
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)

    const maxOutputTokens = screen.getByLabelText('settings.models.add.max_output_tokens.label')
    await user.clear(maxOutputTokens)
    await user.tab()

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        maxOutputTokens: null
      })
    )
    expect(updateModelMock.mock.calls[0][2]).not.toHaveProperty('contextWindow')
    expect(updateModelMock.mock.calls[0][2]).not.toHaveProperty('maxInputTokens')
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
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

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
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

    const cacheReadPrice = screen.getByLabelText('models.price.cache_read')
    await user.clear(cacheReadPrice)
    await user.type(cacheReadPrice, '1a.2.5')

    expect(cacheReadPrice).toHaveValue('1.25')
  })

  it('keeps a tier boundary an integer', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

    const minInputTokens = screen.getByLabelText(/models\.price\.min_input_tokens/)
    await user.clear(minInputTokens)
    await user.type(minInputTokens, '12a.8')
    expect(minInputTokens).toHaveValue('12.8')

    await user.tab()

    expect(minInputTokens).toHaveValue('12')
  })

  // The drawer passes the committed value straight through, because its own state
  // has not re-rendered yet — so what reaches the patch is the settled number, not
  // the text that was typed.
  it('saves the settled context window rather than what was typed', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)

    const field = screen.getByLabelText('settings.models.add.context_window.label')
    await user.clear(field)
    await user.type(field, '3.9')
    await user.tab()

    expect(field).toHaveValue('3')
    await waitFor(() => {
      expect(updateModelMock.mock.calls[0][2]).toEqual(expect.objectContaining({ contextWindow: 3 }))
    })
  })

  it('reports a zero tier boundary instead of raising it to the nearest legal value', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

    const minInputTokens = screen.getByLabelText(/models\.price\.min_input_tokens/)
    await user.clear(minInputTokens)
    await user.type(minInputTokens, '0')
    await user.tab()

    expect(minInputTokens).toHaveValue('0')
    expect(minInputTokens).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('models.price.validation_min_input_tokens')
    expect(updateModelMock).not.toHaveBeenCalled()
  })

  it('preserves explicit zero cache rates and unedited pricing fields when a price is saved', async () => {
    const user = userEvent.setup()
    const model = makeTieredPricingModel()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={model} />)
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

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
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

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
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

    await user.click(screen.getByRole('button', { name: 'models.price.add_tier' }))
    await user.type(screen.getByLabelText('models.price.min_input_tokens, tier 3'), '100000')
    await user.tab()

    expect(screen.getByRole('alert')).toHaveTextContent('models.price.validation_min_input_tokens_order')
    expect(updateModelMock).not.toHaveBeenCalled()
  })

  it('saves a valid tier removal while preserving unedited pricing fields', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeTieredPricingModel()} />)
    await user.click(screen.getByRole('button', { name: 'currency-token' }))

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

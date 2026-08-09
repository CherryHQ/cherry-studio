import { CURRENCY, type Currency, type Model } from '@shared/data/types/model'

type ModelPricing = NonNullable<Model['pricing']>

export const MODEL_PRICING_CURRENCY_SYMBOLS = ['$', '¥'] as const

export type ModelPricingCurrencySymbol = (typeof MODEL_PRICING_CURRENCY_SYMBOLS)[number]

export type ModelPricingDraftField =
  | 'minInputTokens'
  | 'inputPrice'
  | 'outputPrice'
  | 'cacheReadPrice'
  | 'cacheWritePrice'

export type ModelPricingDraftError = 'invalidPrice' | 'invalidMinInputTokens' | 'minInputTokensNotIncreasing'

export interface ModelPricingTierDraft {
  minInputTokens: string
  inputPrice: string
  outputPrice: string
  cacheReadPrice: string
  cacheWritePrice: string
}

export interface ModelPricingDraft {
  tiers: ModelPricingTierDraft[]
}

export type ModelPricingDraftErrors = Array<Partial<Record<ModelPricingDraftField, ModelPricingDraftError>>>

const CURRENCY_SYMBOL_TO_CODE = {
  $: CURRENCY.USD,
  '¥': CURRENCY.CNY
} as const satisfies Record<ModelPricingCurrencySymbol, Currency>

const CURRENCY_CODE_TO_SYMBOL = {
  [CURRENCY.USD]: '$',
  [CURRENCY.CNY]: '¥'
} as const satisfies Record<Currency, ModelPricingCurrencySymbol>

function priceToDraft(price: { perMillionTokens: number | null } | undefined, fallback: string): string {
  return price?.perMillionTokens == null ? fallback : String(price.perMillionTokens)
}

function optionalPriceToDraft(price: { perMillionTokens: number | null } | undefined): string {
  return price?.perMillionTokens == null ? '' : String(price.perMillionTokens)
}

function createTierDraft(
  minInputTokens: number,
  prices: Pick<ModelPricing, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>
): ModelPricingTierDraft {
  return {
    minInputTokens: String(minInputTokens),
    inputPrice: priceToDraft(prices.input, '0'),
    outputPrice: priceToDraft(prices.output, '0'),
    cacheReadPrice: optionalPriceToDraft(prices.cacheRead),
    cacheWritePrice: optionalPriceToDraft(prices.cacheWrite)
  }
}

export function createModelPricingDraft(pricing: Model['pricing']): ModelPricingDraft {
  const baseTier = createTierDraft(0, {
    input: pricing?.input ?? { perMillionTokens: 0 },
    output: pricing?.output ?? { perMillionTokens: 0 },
    cacheRead: pricing?.cacheRead,
    cacheWrite: pricing?.cacheWrite
  })

  return {
    tiers: [
      baseTier,
      ...(pricing?.inputTokenTiers ?? []).map((tier) =>
        createTierDraft(tier.minInputTokens, {
          input: tier.input,
          output: tier.output,
          cacheRead: tier.cacheRead,
          cacheWrite: tier.cacheWrite
        })
      )
    ]
  }
}

export function appendModelPricingTier(draft: ModelPricingDraft): ModelPricingDraft {
  const previousTier = draft.tiers.at(-1) ?? createModelPricingDraft(undefined).tiers[0]
  return {
    ...draft,
    tiers: [...draft.tiers, { ...previousTier, minInputTokens: '' }]
  }
}

export function updateModelPricingTier(
  draft: ModelPricingDraft,
  tierIndex: number,
  field: ModelPricingDraftField,
  value: string
): ModelPricingDraft {
  return {
    ...draft,
    tiers: draft.tiers.map((tier, index) => (index === tierIndex ? { ...tier, [field]: value } : tier))
  }
}

export function removeModelPricingTier(draft: ModelPricingDraft, tierIndex: number): ModelPricingDraft {
  if (tierIndex <= 0) {
    return draft
  }

  return {
    ...draft,
    tiers: draft.tiers.filter((_, index) => index !== tierIndex)
  }
}

export function clearModelPricingDraftError(
  errors: ModelPricingDraftErrors,
  tierIndex: number,
  field: ModelPricingDraftField
): ModelPricingDraftErrors {
  if (!errors[tierIndex]?.[field]) {
    return errors
  }

  return errors.map((tierErrors, index) => {
    if (index !== tierIndex) {
      return tierErrors
    }

    const nextErrors = { ...tierErrors }
    delete nextErrors[field]
    return nextErrors
  })
}

export function isModelPricingCurrencySymbol(value: string): value is ModelPricingCurrencySymbol {
  return MODEL_PRICING_CURRENCY_SYMBOLS.includes(value as ModelPricingCurrencySymbol)
}

export function getModelPricingCurrencySymbol(pricing: Model['pricing']): ModelPricingCurrencySymbol {
  const flatPrices = pricing ? [pricing.input, pricing.output, pricing.cacheRead, pricing.cacheWrite] : []
  const tierPrices = (pricing?.inputTokenTiers ?? []).flatMap((tier) => [
    tier.input,
    tier.output,
    tier.cacheRead,
    tier.cacheWrite
  ])
  const currency = [...flatPrices, ...tierPrices].find((price) => price?.currency)?.currency

  return CURRENCY_CODE_TO_SYMBOL[currency ?? CURRENCY.USD]
}

interface ParsedModelPricingTier {
  minInputTokens: number
  inputPrice: number
  outputPrice: number
  cacheReadPrice?: number
  cacheWritePrice?: number
}

function parsePrice(value: string, optional: boolean): { error?: ModelPricingDraftError; value?: number } {
  const trimmedValue = value.trim()
  if (optional && trimmedValue === '') {
    return {}
  }

  const parsedValue = Number(trimmedValue)
  if (trimmedValue === '' || !Number.isFinite(parsedValue) || parsedValue < 0) {
    return { error: 'invalidPrice' }
  }

  return { value: parsedValue }
}

function parseModelPricingDraft(draft: ModelPricingDraft): {
  errors: ModelPricingDraftErrors
  tiers?: ParsedModelPricingTier[]
} {
  const errors: ModelPricingDraftErrors = draft.tiers.map(() => ({}))
  const parsedTiers: ParsedModelPricingTier[] = []
  let previousMinInputTokens = 0

  for (const [index, tier] of draft.tiers.entries()) {
    const tierErrors = errors[index]
    let minInputTokens = 0

    if (index > 0) {
      const parsedMinInputTokens = Number(tier.minInputTokens.trim())
      if (
        tier.minInputTokens.trim() === '' ||
        !Number.isSafeInteger(parsedMinInputTokens) ||
        parsedMinInputTokens <= 0
      ) {
        tierErrors.minInputTokens = 'invalidMinInputTokens'
      } else {
        minInputTokens = parsedMinInputTokens
        if (minInputTokens <= previousMinInputTokens) {
          tierErrors.minInputTokens = 'minInputTokensNotIncreasing'
        }
        previousMinInputTokens = minInputTokens
      }
    }

    const inputPrice = parsePrice(tier.inputPrice, false)
    const outputPrice = parsePrice(tier.outputPrice, false)
    const cacheReadPrice = parsePrice(tier.cacheReadPrice, true)
    const cacheWritePrice = parsePrice(tier.cacheWritePrice, true)

    if (inputPrice.error) tierErrors.inputPrice = inputPrice.error
    if (outputPrice.error) tierErrors.outputPrice = outputPrice.error
    if (cacheReadPrice.error) tierErrors.cacheReadPrice = cacheReadPrice.error
    if (cacheWritePrice.error) tierErrors.cacheWritePrice = cacheWritePrice.error

    parsedTiers.push({
      minInputTokens,
      inputPrice: inputPrice.value ?? 0,
      outputPrice: outputPrice.value ?? 0,
      ...(cacheReadPrice.value !== undefined ? { cacheReadPrice: cacheReadPrice.value } : {}),
      ...(cacheWritePrice.value !== undefined ? { cacheWritePrice: cacheWritePrice.value } : {})
    })
  }

  if (errors.some((tierErrors) => Object.keys(tierErrors).length > 0)) {
    return { errors }
  }

  return { errors, tiers: parsedTiers }
}

function createPrice(perMillionTokens: number, currency: Currency) {
  return { perMillionTokens, currency }
}

export function buildModelPricingFromDraft(
  currentPricing: Model['pricing'],
  draft: ModelPricingDraft,
  currencySymbol: ModelPricingCurrencySymbol
): { errors: ModelPricingDraftErrors; pricing?: ModelPricing } {
  const { errors, tiers } = parseModelPricingDraft(draft)
  if (!tiers) {
    return { errors }
  }

  const currency = CURRENCY_SYMBOL_TO_CODE[currencySymbol]
  const [baseTier, ...additionalTiers] = tiers
  const unmodifiedPricing: Partial<ModelPricing> = { ...currentPricing }
  delete unmodifiedPricing.input
  delete unmodifiedPricing.output
  delete unmodifiedPricing.cacheRead
  delete unmodifiedPricing.cacheWrite
  delete unmodifiedPricing.inputTokenTiers

  const pricing: ModelPricing = {
    ...unmodifiedPricing,
    input: createPrice(baseTier.inputPrice, currency),
    output: createPrice(baseTier.outputPrice, currency),
    ...(baseTier.cacheReadPrice !== undefined ? { cacheRead: createPrice(baseTier.cacheReadPrice, currency) } : {}),
    ...(baseTier.cacheWritePrice !== undefined ? { cacheWrite: createPrice(baseTier.cacheWritePrice, currency) } : {}),
    ...(additionalTiers.length > 0
      ? {
          inputTokenTiers: additionalTiers.map((tier) => ({
            minInputTokens: tier.minInputTokens,
            input: createPrice(tier.inputPrice, currency),
            output: createPrice(tier.outputPrice, currency),
            ...(tier.cacheReadPrice !== undefined ? { cacheRead: createPrice(tier.cacheReadPrice, currency) } : {}),
            ...(tier.cacheWritePrice !== undefined ? { cacheWrite: createPrice(tier.cacheWritePrice, currency) } : {})
          }))
        }
      : {})
  }

  return { errors, pricing }
}

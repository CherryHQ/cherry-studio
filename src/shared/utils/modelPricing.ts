import type { PricingTier, RuntimeModelPricing } from '@shared/data/types/model'
import { Cron } from 'croner'

export interface TokenPricing {
  input: PricingTier
  output: PricingTier
  cacheRead?: PricingTier
  cacheWrite?: PricingTier
}

export type ModelPricingRule = NonNullable<RuntimeModelPricing['rules']>[number]

export type CanonicalModelPricing = Omit<RuntimeModelPricing, 'inputTokenTiers' | 'rules'> & {
  rules: ModelPricingRule[]
}

interface CompiledModelPricingRule {
  rule: ModelPricingRule
  cron: Cron[]
}

export interface CompiledModelPricingPolicy {
  pricing: CanonicalModelPricing
  rules: CompiledModelPricingRule[]
}

export interface PricingResolution {
  rates: TokenPricing
  appliedRuleIndexes: number[]
}

function copyRates(pricing: TokenPricing): TokenPricing {
  return {
    input: { ...pricing.input },
    output: { ...pricing.output },
    ...(pricing.cacheRead ? { cacheRead: { ...pricing.cacheRead } } : {}),
    ...(pricing.cacheWrite ? { cacheWrite: { ...pricing.cacheWrite } } : {})
  }
}

export function normalizeModelPricing(pricing: RuntimeModelPricing): CanonicalModelPricing {
  const legacyRules: ModelPricingRule[] = (pricing.inputTokenTiers ?? []).map((tier) => ({
    when: { minInputTokens: tier.minInputTokens },
    pricing: copyRates(tier)
  }))

  return {
    input: { ...pricing.input },
    output: { ...pricing.output },
    ...(pricing.cacheRead ? { cacheRead: { ...pricing.cacheRead } } : {}),
    ...(pricing.cacheWrite ? { cacheWrite: { ...pricing.cacheWrite } } : {}),
    ...(pricing.perImage ? { perImage: { ...pricing.perImage } } : {}),
    ...(pricing.perMinute ? { perMinute: { ...pricing.perMinute } } : {}),
    rules:
      pricing.rules?.map((rule) => ({
        when: {
          ...(rule.when.minInputTokens !== undefined ? { minInputTokens: rule.when.minInputTokens } : {}),
          ...(rule.when.time
            ? {
                time: {
                  ...rule.when.time,
                  ...(rule.when.time.cron ? { cron: [...rule.when.time.cron] } : {})
                }
              }
            : {})
        },
        pricing: Object.fromEntries(
          Object.entries(rule.pricing).map(([field, rate]) => [field, rate ? { ...rate } : rate])
        ) as ModelPricingRule['pricing']
      })) ?? legacyRules
  }
}

export function compileModelPricingPolicy(pricing: RuntimeModelPricing): CompiledModelPricingPolicy {
  const canonical = normalizeModelPricing(pricing)
  return {
    pricing: canonical,
    rules: canonical.rules.map((rule) => ({
      rule,
      cron: (rule.when.time?.cron ?? []).map(
        (expression) =>
          new Cron(expression, {
            mode: '5-part',
            paused: true,
            timezone: rule.when.time!.timezone
          })
      )
    }))
  }
}

function matchesTime(rule: CompiledModelPricingRule, at: Date): boolean {
  const time = rule.rule.when.time
  if (!time) return true
  const timestamp = at.getTime()
  if (time.startsAt && timestamp < Date.parse(time.startsAt)) return false
  if (time.endsAt && timestamp >= Date.parse(time.endsAt)) return false
  if (rule.cron.length === 0) return true

  const minute = new Date(timestamp)
  minute.setSeconds(0, 0)
  return rule.cron.some((cron) => cron.match(minute))
}

export function resolveModelPricing(
  policy: CompiledModelPricingPolicy,
  context: { at: Date; inputTokens: number }
): PricingResolution {
  let rates = copyRates(policy.pricing)
  const appliedRuleIndexes: number[] = []

  for (const [index, compiledRule] of policy.rules.entries()) {
    const { minInputTokens } = compiledRule.rule.when
    if (minInputTokens !== undefined && context.inputTokens < minInputTokens) continue
    if (!matchesTime(compiledRule, context.at)) continue
    rates = { ...rates, ...compiledRule.rule.pricing }
    appliedRuleIndexes.push(index)
  }

  return { rates, appliedRuleIndexes }
}

export function projectModelPricingAt(
  policy: CompiledModelPricingPolicy,
  at: Date
): {
  base: PricingResolution
  tiers: Array<{ minInputTokens: number; resolution: PricingResolution }>
} {
  const thresholds = new Set<number>()
  for (const rule of policy.rules) {
    if (rule.rule.when.minInputTokens !== undefined && matchesTime(rule, at)) {
      thresholds.add(rule.rule.when.minInputTokens)
    }
  }

  return {
    base: resolveModelPricing(policy, { at, inputTokens: 0 }),
    tiers: [...thresholds]
      .sort((left, right) => left - right)
      .map((minInputTokens) => ({
        minInputTokens,
        resolution: resolveModelPricing(policy, { at, inputTokens: minInputTokens })
      }))
  }
}

import { describe, expect, it } from 'vitest'

import { extractProviderCostWithCurrency } from '../billingCost'

describe('extractProviderCostWithCurrency', () => {
  it('reads provider cost only when its currency is explicit', () => {
    expect(extractProviderCostWithCurrency({ cost: 0.0123, currency: 'USD' })).toEqual({
      amount: 0.0123,
      currency: 'USD'
    })
    expect(extractProviderCostWithCurrency({ usage: { cost: 0.5, currency: 'CNY' } })).toEqual({
      amount: 0.5,
      currency: 'CNY'
    })
  })

  it('does not invent a currency or retain invalid provider costs', () => {
    expect(extractProviderCostWithCurrency({ cost: 0.0123 })).toBeUndefined()
    expect(extractProviderCostWithCurrency({ cost: -1, currency: 'USD' })).toBeUndefined()
    expect(extractProviderCostWithCurrency({ cost: Number.NaN, currency: 'USD' })).toBeUndefined()
    expect(extractProviderCostWithCurrency({ cost: 1, currency: 'EUR' })).toBeUndefined()
  })

  it('uses an explicit registry-owned currency for amount-only provider costs', () => {
    expect(extractProviderCostWithCurrency({ cost: 0.0123 }, 'USD')).toEqual({
      amount: 0.0123,
      currency: 'USD'
    })
    expect(extractProviderCostWithCurrency({ usage: { cost: 0.5 } }, 'CNY')).toEqual({
      amount: 0.5,
      currency: 'CNY'
    })
    expect(extractProviderCostWithCurrency({ cost: 1, currency: 'EUR' }, 'USD')).toBeUndefined()
  })
})

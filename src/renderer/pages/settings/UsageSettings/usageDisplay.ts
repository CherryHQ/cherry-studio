export const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_COST_CURRENCY = 'USD'

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function formatCost(value: number, currency: string | null | undefined): string {
  const normalizedCurrency = currency?.toUpperCase() ?? DEFAULT_COST_CURRENCY
  const symbol = normalizedCurrency === 'CNY' ? '¥' : '$'
  const fractionDigits = value > 0 && value < 1 ? 4 : 2

  return `${symbol}${value.toFixed(fractionDigits)}`
}

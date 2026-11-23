const MARKETPLACE_CATEGORY_KEYS: ReadonlyMap<string, string> = new Map([
  ['AI & Agents', 'marketplace.category.ai_agents'],
  ['Productivity', 'marketplace.category.productivity'],
  ['Developer Tools', 'marketplace.category.developer_tools'],
  ['Design', 'marketplace.category.design'],
  ['Data & Analytics', 'marketplace.category.data_analytics'],
  ['Communication', 'marketplace.category.communication'],
  ['Documentation', 'marketplace.category.documentation'],
  ['Automation', 'marketplace.category.automation'],
  ['Legal', 'marketplace.category.legal'],
  ['Other', 'marketplace.category.other']
])

export function getMarketplaceCategoryLabel(category: string, translate: (key: string) => string): string {
  const key = MARKETPLACE_CATEGORY_KEYS.get(category)

  return key ? translate(key) : category
}

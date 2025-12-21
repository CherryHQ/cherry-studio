import type { UsageCategory, UsageModule, UsageOperation } from '@renderer/types'

export const USAGE_MODULE_LABEL_KEYS = {
  agent: 'usage.modules.agent',
  chat: 'usage.modules.chat',
  knowledge: 'usage.modules.knowledge',
  paintings: 'usage.modules.paintings',
  translate: 'usage.modules.translate',
  websearch: 'usage.modules.websearch'
} as const satisfies Record<UsageModule, string>

export const USAGE_CATEGORY_LABEL_KEYS = {
  embedding: 'usage.categories.embedding',
  image_generation: 'usage.categories.image_generation',
  language: 'usage.categories.language',
  multimodal: 'usage.categories.multimodal',
  rerank: 'usage.categories.rerank',
  web_search: 'usage.categories.web_search'
} as const satisfies Record<UsageCategory, string>

export const USAGE_OPERATION_LABEL_KEYS = {
  completion: 'usage.operations.completion',
  embedding: 'usage.operations.embedding',
  generate_image: 'usage.operations.generate_image',
  ingest: 'usage.operations.ingest',
  other: 'usage.operations.other',
  rerank: 'usage.operations.rerank',
  search: 'usage.operations.search'
} as const satisfies Record<UsageOperation, string>

export const getUsageModuleLabelKey = (module: UsageModule): string => USAGE_MODULE_LABEL_KEYS[module]

export const getUsageCategoryLabelKey = (category: UsageCategory): string => USAGE_CATEGORY_LABEL_KEYS[category]

export const getUsageOperationLabelKey = (operation: UsageOperation): string => USAGE_OPERATION_LABEL_KEYS[operation]

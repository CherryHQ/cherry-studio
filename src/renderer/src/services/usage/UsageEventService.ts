import { loggerService } from '@logger'
import db from '@renderer/databases'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type {
  Model,
  Usage,
  UsageCategory,
  UsageEvent,
  UsageModule,
  UsageOperation,
  UsageRefType,
  UsageSource
} from '@renderer/types'

import {
  buildPricingSnapshot,
  calculateImageCost,
  calculatePricingCost,
  getCurrencySymbol,
  getUsageCategoryForModel
} from './usageUtils'

const logger = loggerService.withContext('UsageEventService')

type TokenUsageEventParams = {
  id: string
  module: UsageModule
  operation: UsageOperation
  occurredAt: number
  model?: Model
  providerId?: string
  modelId?: string
  modelName?: string
  category?: UsageCategory
  usage?: Usage
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  usageSource?: UsageSource
  costProvider?: number
  costPricing?: number
  currencyProvider?: string
  topicId?: string
  messageId?: string
  refType?: UsageRefType
  refId?: string
  baseId?: string
  itemId?: string
  paintingId?: string
}

type ImageUsageEventParams = {
  id: string
  occurredAt: number
  module?: UsageModule
  providerId?: string
  modelId?: string
  modelName?: string
  prompt?: string
  imageCount: number
  costProvider?: number
  pricing?: {
    price?: number
    currency?: string
    unit?: number
  }
  refType?: UsageRefType
  refId?: string
  paintingId?: string
}

export const saveUsageEvent = async (event: UsageEvent) => {
  try {
    await db.usage_events.put(event)
  } catch (error) {
    logger.error('Failed to save usage event', error as Error, { eventId: event.id, module: event.module })
  }
}

export const buildTokenUsageEvent = (params: TokenUsageEventParams): UsageEvent => {
  const promptTokens = params.promptTokens ?? params.usage?.prompt_tokens ?? 0
  const completionTokens = params.completionTokens ?? params.usage?.completion_tokens ?? 0
  const totalTokens = params.totalTokens ?? params.usage?.total_tokens ?? promptTokens + completionTokens
  const model = params.model
  const pricingSnapshot = buildPricingSnapshot(model?.pricing)
  const costPricing =
    params.costPricing ?? calculatePricingCost({ promptTokens, completionTokens }, pricingSnapshot) ?? undefined
  const costProvider = params.costProvider ?? params.usage?.cost

  return {
    id: params.id,
    module: params.module,
    operation: params.operation,
    occurredAt: params.occurredAt,
    providerId: params.providerId ?? model?.provider,
    modelId: params.modelId ?? model?.id,
    modelName: params.modelName ?? model?.name,
    category: params.category ?? getUsageCategoryForModel(model),
    promptTokens,
    completionTokens,
    totalTokens,
    usageSource: params.usageSource ?? 'api',
    costProvider,
    costPricing,
    currencyProvider:
      costProvider !== undefined
        ? getCurrencySymbol(params.currencyProvider ?? model?.pricing?.currencySymbol)
        : undefined,
    currencyPricing: costPricing !== undefined ? getCurrencySymbol(pricingSnapshot?.currencySymbol) : undefined,
    pricingSnapshot,
    topicId: params.topicId,
    messageId: params.messageId,
    refType: params.refType,
    refId: params.refId,
    baseId: params.baseId,
    itemId: params.itemId,
    paintingId: params.paintingId
  }
}

export const buildImageUsageEvent = (params: ImageUsageEventParams): UsageEvent => {
  const promptTokens = params.prompt ? estimateTextTokens(params.prompt) : undefined
  const costPricing = calculateImageCost({
    imageCount: params.imageCount,
    price: params.pricing?.price,
    unit: params.pricing?.unit
  })

  return {
    id: params.id,
    module: params.module ?? 'paintings',
    operation: 'generate_image',
    occurredAt: params.occurredAt,
    providerId: params.providerId,
    modelId: params.modelId,
    modelName: params.modelName,
    category: 'image_generation',
    promptTokens,
    completionTokens: 0,
    totalTokens: promptTokens,
    usageSource: promptTokens !== undefined ? 'estimate' : 'none',
    costProvider: params.costProvider,
    costPricing,
    currencyProvider: params.costProvider !== undefined ? getCurrencySymbol(params.pricing?.currency) : undefined,
    currencyPricing: costPricing !== undefined ? getCurrencySymbol(params.pricing?.currency) : undefined,
    imageCount: params.imageCount,
    refType: params.refType,
    refId: params.refId,
    paintingId: params.paintingId
  }
}

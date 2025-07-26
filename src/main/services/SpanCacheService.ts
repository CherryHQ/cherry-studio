import { loggerService } from '@logger'
import { Attributes, convertSpanToSpanEntity, SpanEntity, TokenUsage, TraceCache } from '@mcp-trace/trace-core'
import { SpanStatusCode } from '@opentelemetry/api'
import { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { configManager } from './ConfigManager'

const logger = loggerService.withContext('SpanCacheService')

class SpanCacheService implements TraceCache {
  private topicMap: Map<string, string> = new Map<string, string>()
  private fileDir: string
  private cache: Map<string, SpanEntity> = new Map<string, SpanEntity>()
  pri

  constructor() {
    this.fileDir = path.join(os.homedir(), '.cherrystudio', 'trace')
  }

  createSpan: (span: ReadableSpan) => void = (span: ReadableSpan) => {
    if (!configManager.getEnableDeveloperMode()) {
      return
    }
    const spanEntity = convertSpanToSpanEntity(span)
    spanEntity.topicId = this.topicMap.get(spanEntity.traceId)
    this.cache.set(span.spanContext().spanId, spanEntity)
    this._updateModelName(spanEntity)
  }

  endSpan: (span: ReadableSpan) => void = (span: ReadableSpan) => {
    if (!configManager.getEnableDeveloperMode()) {
      return
    }
    const spanId = span.spanContext().spanId
    const spanEntity = this.cache.get(spanId)
    if (!spanEntity) {
      return
    }

    spanEntity.topicId = this.topicMap.get(spanEntity.traceId)
    spanEntity.endTime = span.endTime ? span.endTime[0] * 1e3 + Math.floor(span.endTime[1] / 1e6) : null
    spanEntity.status = SpanStatusCode[span.status.code]
    spanEntity.attributes = span.attributes ? ({ ...span.attributes } as Attributes) : {}
    spanEntity.events = span.events
    spanEntity.links = span.links
    this._updateModelName(spanEntity)
  }

  clear: () => void = () => {
    this.cache.clear()
  }

  async cleanTopic(topicId: string, traceId?: string, modelName?: string) {
    const spans = Array.from(this.cache.values().filter((e) => e.topicId === topicId))
    spans.map((e) => e.id).forEach((id) => this.cache.delete(id))

    await this._checkFolder(path.join(this.fileDir, topicId))

    if (modelName) {
      this.cleanHistoryTrace(topicId, traceId || '', modelName)
      this.saveSpans(topicId)
    } else if (traceId) {
      fs.rm(path.join(this.fileDir, topicId, traceId))
    } else {
      fs.readdir(path.join(this.fileDir, topicId)).then((files) =>
        files.forEach((file) => {
          fs.rm(path.join(this.fileDir, topicId, file))
        })
      )
    }
  }

  async cleanLocalData() {
    this.cache.clear()
    fs.readdir(this.fileDir)
      .then((files) =>
        files.forEach((topicId) => {
          fs.rm(path.join(this.fileDir, topicId), { recursive: true, force: true })
        })
      )
      .catch((err) => {
        logger.error('Error cleaning local data:', err)
      })
  }

  async saveSpans(topicId: string) {
    if (!configManager.getEnableDeveloperMode()) {
      return
    }
    let traceId: string | undefined
    for (const [key, value] of this.topicMap.entries()) {
      if (value === topicId) {
        traceId = key
        break // 找到后立即退出循环
      }
    }
    if (!traceId) {
      return
    }
    const spans = Array.from(this.cache.values().filter((e) => e.traceId === traceId || !e.modelName))
    await this._saveToFile(spans, traceId, topicId)
    this.topicMap.delete(traceId)
    this._cleanCache(traceId)
  }

  async getSpans(topicId: string, traceId: string, modelName?: string) {
    if (this.topicMap.has(traceId)) {
      const spans: SpanEntity[] = []
      this.cache
        .values()
        .filter((spanEntity) => {
          return spanEntity.traceId === traceId && spanEntity.modelName
        })
        .filter((spanEntity) => {
          return !modelName || spanEntity.modelName === modelName
        })
        .forEach((sp) => spans.push(sp))
      return spans
    } else {
      return this._getHisData(topicId, traceId, modelName)
    }
  }

  /**
   * binding topic id to trace
   * @param traceId traceId
   * @param topicId topicId
   */
  setTopicId(traceId: string, topicId: string): void {
    this.topicMap.set(traceId, topicId)
  }

  getEntity(spanId: string): SpanEntity | undefined {
    return this.cache.get(spanId)
  }

  saveEntity(entity: SpanEntity) {
    if (!configManager.getEnableDeveloperMode()) {
      return
    }
    if (this.cache.has(entity.id)) {
      this._updateEntity(entity)
    } else {
      this._addEntity(entity)
    }
    this._updateModelName(entity)
  }

  updateTokenUsage(spanId: string, usage: TokenUsage) {
    const entity = this.cache.get(spanId)
    if (entity) {
      entity.usage = { ...usage }
    }
    if (entity?.parentId) {
      this._updateParentUsage(entity.parentId, usage)
    }
  }

  addStreamMessage(spanId: string, modelName: string, context: string, message: any) {
    const span = this.cache.get(spanId)
    if (!span) {
      return
    }
    const attributes = span.attributes
    let msgArray: any[] = []
    if (attributes && attributes['outputs'] && Array.isArray(attributes['outputs'])) {
      msgArray = attributes['outputs'] || []
      msgArray.push(message)
      attributes['outputs'] = msgArray
    } else {
      msgArray = [message]
      span.attributes = { ...attributes, outputs: msgArray } as Attributes
    }
    this._updateParentOutputs(span.parentId, modelName, context)
  }

  setEndMessage(spanId: string, modelName: string, message: string) {
    const span = this.cache.get(spanId)
    if (span && span.attributes) {
      let outputs = span.attributes['outputs']
      if (!outputs || typeof outputs !== 'object') {
        outputs = {}
      }
      if (!(`${modelName}` in outputs) || !outputs[`${modelName}`]) {
        outputs[`${modelName}`] = message
        span.attributes[`outputs`] = outputs
        this.cache.set(spanId, span)
      }
    }
  }

  async cleanHistoryTrace(topicId: string, traceId: string, modelName?: string) {
    this._cleanCache(traceId, modelName)

    const filePath = path.join(this.fileDir, topicId, traceId)
    const fileExists = await this._existFile(filePath)

    if (!fileExists) {
      return
    }

    if (!modelName) {
      await fs.rm(filePath, { recursive: true })
    } else {
      const allSpans = await this._getHisData(topicId, traceId)
      allSpans.forEach((span) => {
        if (!modelName || modelName !== span.modelName) {
          this.cache.set(span.id, span)
        }
      })
      try {
        await fs.rm(filePath, { recursive: true })
      } catch (error) {
        logger.error('Error cleaning local data:', error as Error)
      }
    }
  }

  private _addEntity(entity: SpanEntity): void {
    entity.topicId = this.topicMap.get(entity.traceId)
    this.cache.set(entity.id, entity)
  }

  private _updateModelName(entity: SpanEntity) {
    let modelName = entity.modelName || entity.attributes?.modelName?.toString()
    if (!modelName && entity.parentId) {
      modelName = this.cache.get(entity.parentId)?.modelName
    }
    entity.modelName = modelName
  }
  private _updateEntity(entity: SpanEntity): void {
    entity.topicId = this.topicMap.get(entity.traceId)
    const savedEntity = this.cache.get(entity.id)
    if (savedEntity) {
      Object.keys(entity).forEach((key) => {
        const value = entity[key]
        if (value === undefined) {
          savedEntity[key] = value
          return
        }
        if (key === 'attributes') {
          const savedAttrs = savedEntity.attributes || {}
          Object.keys(value).forEach((attrKey) => {
            const jsonData =
              typeof value[attrKey] === 'string' && value[attrKey].startsWith('{')
                ? JSON.parse(value[attrKey])
                : value[attrKey]
            if (
              savedAttrs[attrKey] !== undefined &&
              typeof jsonData === 'object' &&
              typeof savedAttrs[attrKey] === 'object'
            ) {
              savedAttrs[attrKey] = { ...savedAttrs[attrKey], ...jsonData }
            } else {
              savedAttrs[attrKey] = value[attrKey]
            }
          })
          savedEntity.attributes = savedAttrs
        } else {
          savedEntity[key] = value
        }
      })
      this.cache.set(entity.id, savedEntity)
    }
  }

  private _cleanCache(traceId: string, modelName?: string) {
    this.cache
      .values()
      .filter((span) => {
        return span && span.traceId === traceId && (!modelName || span.modelName === modelName)
      })
      .forEach((span) => this.cache.delete(span.id))
  }

  private _updateParentOutputs(spanId: string, modelName: string, context: string) {
    const span = this.cache.get(spanId)
    if (!span || !context) {
      return
    }
    const attributes = span.attributes
    // 如果含有modelName属性，是具体的某个modalName输出，拼接到streamText下面
    if (attributes && span.modelName) {
      const currentValue = attributes['outputs']
      if (currentValue && typeof currentValue === 'object') {
        const allContext = (currentValue['streamText'] || '') + context
        attributes['outputs'] = { ...currentValue, streamText: allContext }
      } else {
        attributes['outputs'] = { streamText: context }
      }
      span.attributes = attributes
    } else if (span.modelName) {
      span.attributes = { outputs: { [`${modelName}`]: context } } as Attributes
    } else {
      return
    }
    this.cache.set(span.id, span)
    this._updateParentOutputs(span.parentId, modelName, context)
  }

  private _updateParentUsage(spanId: string, usage: TokenUsage) {
    const entity = this.cache.get(spanId)
    if (!entity) {
      return
    }
    if (!entity.usage) {
      entity.usage = { ...usage }
    } else {
      entity.usage.prompt_tokens = entity.usage.prompt_tokens + usage.prompt_tokens
      entity.usage.completion_tokens = entity.usage.completion_tokens + usage.completion_tokens
      entity.usage.total_tokens = entity.usage.total_tokens + usage.total_tokens
    }
    this.cache.set(entity.id, entity)
    if (entity?.parentId) {
      this._updateParentUsage(entity.parentId, usage)
    }
  }

  private async _saveToFile(spans: SpanEntity[], traceId: string, topicId: string) {
    const dirPath = path.join(this.fileDir, topicId)
    await this._checkFolder(dirPath)

    const filePath = path.join(dirPath, traceId)

    const writeOperations = spans
      .filter((span) => span.topicId)
      .map(async (span) => {
        await fs.appendFile(filePath, JSON.stringify(span) + '\n')
      })

    await Promise.all(writeOperations)
  }

  private async _getHisData(topicId: string, traceId: string, modelName?: string) {
    const filePath = path.join(this.fileDir, topicId, traceId)

    if (!(await this._existFile(filePath))) {
      return []
    }

    try {
      const fileHandle = await fs.open(filePath, 'r')
      const stream = fileHandle.createReadStream()
      const chunks: string[] = []

      for await (const chunk of stream) {
        chunks.push(chunk.toString())
      }
      await fileHandle.close()

      // 使用生成器逐行处理
      const parseLines = function* (text: string) {
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (trimmed) {
            try {
              yield JSON.parse(trimmed) as SpanEntity
            } catch (e) {
              logger.error(`JSON解析失败: ${trimmed}`, e as Error)
            }
          }
        }
      }

      return Array.from(parseLines(chunks.join('')))
        .filter((span) => span.topicId === topicId && span.traceId === traceId && span.modelName)
        .filter((span) => !modelName || span.modelName === modelName)
    } catch (err) {
      logger.error('Error parsing JSON:', err as Error)
      throw err
    }
  }

  private async _checkFolder(filePath: string) {
    try {
      await fs.mkdir(filePath, { recursive: true })
    } catch (err) {
      if (typeof err === 'object' && err && 'code' in err && err.code !== 'EEXIST') throw err
    }
  }

  private async _existFile(filePath: string) {
    try {
      await fs.access(filePath)
      return true
    } catch (err) {
      logger.error('delete trace file error:', err as Error)
      return false
    }
  }
}

export const spanCacheService = new SpanCacheService()
export const cleanTopic = spanCacheService.cleanTopic.bind(spanCacheService)
export const saveEntity = spanCacheService.saveEntity.bind(spanCacheService)
export const getEntity = spanCacheService.getEntity.bind(spanCacheService)
export const tokenUsage = spanCacheService.updateTokenUsage.bind(spanCacheService)
export const saveSpans = spanCacheService.saveSpans.bind(spanCacheService)
export const getSpans = spanCacheService.getSpans.bind(spanCacheService)
export const addEndMessage = spanCacheService.setEndMessage.bind(spanCacheService)
export const bindTopic = spanCacheService.setTopicId.bind(spanCacheService)
export const addStreamMessage = spanCacheService.addStreamMessage.bind(spanCacheService)
export const cleanHistoryTrace = spanCacheService.cleanHistoryTrace.bind(spanCacheService)
export const cleanLocalData = spanCacheService.cleanLocalData.bind(spanCacheService)

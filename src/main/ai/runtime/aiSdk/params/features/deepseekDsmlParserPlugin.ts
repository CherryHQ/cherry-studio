import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isDeepSeekModel } from '@shared/utils/model'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'

const logger = loggerService.withContext('deepseekDsmlParser')

const TOOL_CALLS_OPEN_TAGS = ['<｜DSML｜tool_calls>', '<｜｜DSML｜｜tool_calls>'] as const
const TOOL_CALLS_CLOSE_TAGS = ['</｜DSML｜tool_calls>', '</｜｜DSML｜｜tool_calls>'] as const
const TOOL_SEARCH_LOOP_OPEN_TAGS = ['<｜DSML｜Tool loop>', '<｜｜DSML｜｜Tool loop>'] as const
const TOOL_SEARCH_LOOP_CLOSE_TAGS = ['</｜DSML｜Tool>', '</｜｜DSML｜｜Tool>'] as const
const DSML_OPEN_TAGS = [...TOOL_CALLS_OPEN_TAGS, ...TOOL_SEARCH_LOOP_OPEN_TAGS] as const
const SWALLOW_BUFFER_LIMIT = 64 * 1024

const TOOL_BLOCK_RE =
  /<｜{1,2}DSML｜{1,2}(?:tool_)?(invoke|tool)\s+name="([^"]+)">([\s\S]*?)<\/｜{1,2}DSML｜{1,2}(?:tool_)?\1>/g
const PARAM_RE =
  /<｜{1,2}DSML｜{1,2}parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)<\/｜{1,2}DSML｜{1,2}parameter>/g

interface ParsedDsmlCall {
  toolName: string
  args: Record<string, unknown>
}

function parseInvokeBlocks(dsmlContent: string): ParsedDsmlCall[] {
  const calls: ParsedDsmlCall[] = []
  TOOL_BLOCK_RE.lastIndex = 0
  let invokeMatch: RegExpExecArray | null
  while ((invokeMatch = TOOL_BLOCK_RE.exec(dsmlContent)) !== null) {
    const toolName = invokeMatch[2]
    const inner = invokeMatch[3]
    const args: Record<string, unknown> = {}

    PARAM_RE.lastIndex = 0
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = PARAM_RE.exec(inner)) !== null) {
      const paramName = paramMatch[1]
      const isString = paramMatch[2] !== 'false'
      const rawValue = paramMatch[3]
      if (isString) {
        args[paramName] = rawValue
      } else {
        try {
          args[paramName] = JSON.parse(rawValue)
        } catch {
          args[paramName] = rawValue
        }
      }
    }
    calls.push({ toolName, args })
  }
  return calls
}

function parseDsmlCalls(
  dsmlContent: string,
  openTag: string,
  tools: readonly { name: string }[] | undefined
): ParsedDsmlCall[] {
  const calls = parseInvokeBlocks(dsmlContent)
  if (calls.length > 0 || !TOOL_SEARCH_LOOP_OPEN_TAGS.some((tag) => tag === openTag)) return calls

  const toolSearch = tools?.find((tool) => tool.name.toLowerCase() === 'toolsearch')
  const search = /^\s*<search>([\s\S]+)<\/search>\s*$/.exec(dsmlContent)
  if (!toolSearch || !search) return []

  return [{ toolName: toolSearch.name, args: { query: search[1] } }]
}

function getCloseTags(openTag: string): readonly string[] {
  return TOOL_SEARCH_LOOP_OPEN_TAGS.some((tag) => tag === openTag) ? TOOL_SEARCH_LOOP_CLOSE_TAGS : TOOL_CALLS_CLOSE_TAGS
}

// Find longest suffix of `buffer` that is a non-empty prefix of `target`.
// Used to keep partial DSML opening tag in buffer across chunk boundaries.
function findPartialPrefix(buffer: string, targets: readonly string[]): number {
  const maxLen = Math.min(buffer.length, Math.max(...targets.map((target) => target.length)) - 1)
  for (let len = maxLen; len > 0; len--) {
    if (targets.some((target) => target.startsWith(buffer.slice(buffer.length - len)))) {
      return buffer.length - len
    }
  }
  return -1
}

function findFirstTag(buffer: string, tags: readonly string[]): { index: number; tag: string } | undefined {
  let first: { index: number; tag: string } | undefined
  for (const tag of tags) {
    const index = buffer.indexOf(tag)
    if (index >= 0 && (!first || index < first.index)) first = { index, tag }
  }
  return first
}

function resolveToolName(toolName: string, tools: readonly { name: string }[] | undefined): string {
  const matches = tools?.filter((tool) => tool.name.toLowerCase() === toolName.toLowerCase()) ?? []
  if (matches.length === 1) return matches[0].name
  return toolName.toLowerCase() === 'skill' ? 'Skill' : toolName
}

function generateToolCallId(): string {
  return `dsml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function createDeepseekDsmlParserMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream, params }) => {
      const { stream, ...rest } = await doStream()

      type ContentType = 'text' | 'reasoning'

      let contentBuffer = ''
      let dsmlBuffer = ''
      let dsmlOpenTag: string = TOOL_CALLS_OPEN_TAGS[0]
      let inDsml = false
      let activeContentId: string | null = null
      let activeContentType: ContentType = 'text'
      let pendingReasoningCalls: ParsedDsmlCall[] = []
      let extractedToolCalls = false

      const enqueueContentDelta = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        contentType: ContentType,
        id: string,
        delta: string
      ) => {
        if (contentType === 'reasoning') {
          controller.enqueue({ type: 'reasoning-delta', id, delta })
        } else {
          controller.enqueue({ type: 'text-delta', id, delta })
        }
      }

      const enqueueToolCalls = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        calls: ParsedDsmlCall[]
      ) => {
        for (const call of calls) {
          const id = generateToolCallId()
          const inputJson = JSON.stringify(call.args)
          controller.enqueue({ type: 'tool-input-start', id, toolName: call.toolName })
          controller.enqueue({ type: 'tool-input-delta', id, delta: inputJson })
          controller.enqueue({ type: 'tool-input-end', id })
          controller.enqueue({
            type: 'tool-call',
            toolCallId: id,
            toolName: call.toolName,
            input: inputJson
          })
        }
        extractedToolCalls = true
        logger.info(`Parsed ${calls.length} DSML tool call(s)`, {
          tools: calls.map((call) => call.toolName)
        })
      }

      // eslint-disable-next-line prefer-const
      let drainDsmlBuffer: (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        contentId: string
      ) => void

      const enqueueRemainderContent = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        contentId: string
      ) => {
        const open = findFirstTag(contentBuffer, DSML_OPEN_TAGS)
        if (!open) {
          const partialIdx = findPartialPrefix(contentBuffer, DSML_OPEN_TAGS)
          if (partialIdx >= 0) {
            const safe = contentBuffer.slice(0, partialIdx)
            if (safe) enqueueContentDelta(controller, activeContentType, contentId, safe)
            contentBuffer = contentBuffer.slice(partialIdx)
          } else {
            if (contentBuffer) enqueueContentDelta(controller, activeContentType, contentId, contentBuffer)
            contentBuffer = ''
          }
          return
        }
        const startIdx = open.index
        if (startIdx > 0) {
          enqueueContentDelta(controller, activeContentType, contentId, contentBuffer.slice(0, startIdx))
        }
        dsmlOpenTag = open.tag
        dsmlBuffer = contentBuffer.slice(startIdx + open.tag.length)
        contentBuffer = ''
        inDsml = true
        drainDsmlBuffer(controller, contentId)
      }

      drainDsmlBuffer = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        contentId: string
      ) => {
        const close = findFirstTag(dsmlBuffer, getCloseTags(dsmlOpenTag))
        if (!close) {
          if (dsmlBuffer.length > SWALLOW_BUFFER_LIMIT) {
            logger.warn('DSML buffer exceeded limit without close tag, falling back to content')
            enqueueContentDelta(controller, activeContentType, contentId, dsmlOpenTag + dsmlBuffer)
            dsmlBuffer = ''
            inDsml = false
          }
          return
        }

        const blockContent = dsmlBuffer.slice(0, close.index)
        const remainder = dsmlBuffer.slice(close.index + close.tag.length)
        const calls = parseDsmlCalls(blockContent, dsmlOpenTag, params.tools).map((call) => ({
          ...call,
          toolName: resolveToolName(call.toolName, params.tools)
        }))

        if (calls.length === 0) {
          logger.warn('DSML block closed but no invoke blocks parsed, emitting as content')
          enqueueContentDelta(controller, activeContentType, contentId, dsmlOpenTag + blockContent + close.tag)
        } else if (activeContentType === 'reasoning') {
          pendingReasoningCalls.push(...calls)
          extractedToolCalls = true
        } else {
          enqueueToolCalls(controller, calls)
        }

        dsmlBuffer = ''
        inDsml = false
        contentBuffer = remainder
        if (contentBuffer) enqueueRemainderContent(controller, contentId)
      }

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(
              chunk: LanguageModelV3StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
            ) {
              if (chunk.type === 'text-start' || chunk.type === 'reasoning-start') {
                activeContentId = chunk.id
                activeContentType = chunk.type === 'text-start' ? 'text' : 'reasoning'
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'text-end' || chunk.type === 'reasoning-end') {
                const contentId = chunk.id
                const contentType = chunk.type === 'text-end' ? 'text' : 'reasoning'
                if (inDsml) {
                  logger.warn(`${chunk.type} with unclosed DSML block, flushing as content`)
                  enqueueContentDelta(controller, contentType, contentId, dsmlOpenTag + dsmlBuffer)
                  dsmlBuffer = ''
                  inDsml = false
                } else if (contentBuffer) {
                  enqueueContentDelta(controller, contentType, contentId, contentBuffer)
                  contentBuffer = ''
                }
                controller.enqueue(chunk)
                if (chunk.type === 'reasoning-end' && pendingReasoningCalls.length > 0) {
                  enqueueToolCalls(controller, pendingReasoningCalls)
                  pendingReasoningCalls = []
                }
                activeContentId = null
                return
              }

              if (chunk.type === 'finish') {
                if (extractedToolCalls && chunk.finishReason.unified === 'stop') {
                  controller.enqueue({
                    ...chunk,
                    finishReason: { ...chunk.finishReason, unified: 'tool-calls' }
                  })
                } else {
                  controller.enqueue(chunk)
                }
                return
              }

              if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') {
                controller.enqueue(chunk)
                return
              }

              const contentId = chunk.id
              activeContentType = chunk.type === 'text-delta' ? 'text' : 'reasoning'
              if (!activeContentId) activeContentId = contentId

              if (inDsml) {
                dsmlBuffer += chunk.delta
                drainDsmlBuffer(controller, contentId)
                return
              }

              contentBuffer += chunk.delta
              enqueueRemainderContent(controller, contentId)
            },
            flush(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) {
              const contentId = activeContentId ?? 'dsml-fallback'
              if (inDsml) {
                logger.warn('Stream flushed with unclosed DSML block')
                enqueueContentDelta(controller, activeContentType, contentId, dsmlOpenTag + dsmlBuffer)
              } else if (contentBuffer) {
                enqueueContentDelta(controller, activeContentType, contentId, contentBuffer)
              }
              if (pendingReasoningCalls.length > 0) enqueueToolCalls(controller, pendingReasoningCalls)
              contentBuffer = ''
              dsmlBuffer = ''
              inDsml = false
              pendingReasoningCalls = []
            }
          })
        ),
        ...rest
      }
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate()
      const newContent: typeof result.content = []
      let extracted = false

      for (const part of result.content) {
        if (part.type !== 'text') {
          newContent.push(part)
          continue
        }
        const text = part.text
        const partsForText: typeof newContent = []
        let textAccum = ''
        let cursor = 0
        let foundCallInPart = false

        while (cursor < text.length) {
          const open = findFirstTag(text.slice(cursor), DSML_OPEN_TAGS)
          if (!open) {
            textAccum += text.slice(cursor)
            break
          }
          const startIdx = cursor + open.index
          const contentStart = startIdx + open.tag.length
          const close = findFirstTag(text.slice(contentStart), getCloseTags(open.tag))
          if (!close) {
            textAccum += text.slice(cursor)
            break
          }

          const closeIdx = contentStart + close.index
          const blockEnd = closeIdx + close.tag.length
          const blockContent = text.slice(contentStart, closeIdx)
          const calls = parseDsmlCalls(blockContent, open.tag, params.tools).map((call) => ({
            ...call,
            toolName: resolveToolName(call.toolName, params.tools)
          }))

          if (calls.length === 0) {
            // Unparseable block — preserve original markup as text instead of dropping it.
            textAccum += text.slice(cursor, blockEnd)
            cursor = blockEnd
            continue
          }

          textAccum += text.slice(cursor, startIdx)
          if (textAccum) {
            partsForText.push({ ...part, text: textAccum })
            textAccum = ''
          }
          for (const call of calls) {
            partsForText.push({
              type: 'tool-call',
              toolCallId: generateToolCallId(),
              toolName: call.toolName,
              input: JSON.stringify(call.args)
            })
          }
          foundCallInPart = true
          cursor = blockEnd
        }

        if (!foundCallInPart) {
          newContent.push(part)
          continue
        }

        newContent.push(...partsForText)
        if (textAccum) newContent.push({ ...part, text: textAccum })
        extracted = true
      }

      if (!extracted) return result

      logger.info('Parsed DSML tool calls in non-streaming response')
      return {
        ...result,
        content: newContent,
        finishReason:
          result.finishReason.unified === 'stop'
            ? { ...result.finishReason, unified: 'tool-calls' }
            : result.finishReason
      }
    }
  }
}

export const createDeepseekDsmlParserPlugin = () =>
  definePlugin({
    name: 'deepseekDsmlParser',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createDeepseekDsmlParserMiddleware())
    }
  })

/**
 * Some DeepSeek deployments emit tool calls as single- or double-bar DSML markup inside text
 * deltas instead of native `tool-call` parts; this re-extracts them. The middleware passes
 * text straight through unless that distinctive markup appears, so gating to DeepSeek models
 * is both sufficient (where the leak happens) and safe (no transform for non-DeepSeek).
 */
export const deepseekDsmlParserFeature: RequestFeature = {
  name: 'deepseek-dsml-parser',
  applies: (scope) => isDeepSeekModel(scope.model),
  contributeModelAdapters: () => [createDeepseekDsmlParserPlugin()]
}

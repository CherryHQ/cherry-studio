import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isDeepSeekModel } from '@shared/utils/model'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'

const logger = loggerService.withContext('deepseekDsmlParser')

const TOOL_CALLS_OPEN = '<｜｜DSML｜｜tool_calls>'
const TOOL_CALLS_CLOSE = '</｜｜DSML｜｜tool_calls>'
const SWALLOW_BUFFER_LIMIT = 64 * 1024

const INVOKE_RE = /<｜｜DSML｜｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/g
const PARAM_RE =
  /<｜｜DSML｜｜parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g

interface ParsedDsmlCall {
  toolName: string
  args: Record<string, unknown>
}

function parseInvokeBlocks(dsmlContent: string): ParsedDsmlCall[] {
  const calls: ParsedDsmlCall[] = []
  INVOKE_RE.lastIndex = 0
  let invokeMatch: RegExpExecArray | null
  while ((invokeMatch = INVOKE_RE.exec(dsmlContent)) !== null) {
    const toolName = invokeMatch[1]
    const inner = invokeMatch[2]
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

// Find longest suffix of `buffer` that is a non-empty prefix of `target`.
// Used to keep partial DSML opening tag in buffer across chunk boundaries.
function findPartialPrefix(buffer: string, target: string): number {
  const maxLen = Math.min(buffer.length, target.length - 1)
  for (let len = maxLen; len > 0; len--) {
    if (target.startsWith(buffer.slice(buffer.length - len))) {
      return buffer.length - len
    }
  }
  return -1
}

function generateToolCallId(): string {
  return `dsml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function enqueueToolCalls(
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  calls: ParsedDsmlCall[]
): void {
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
}

/**
 * One DSML-scanning state machine per output channel (`text` or `reasoning`).
 *
 * The reasoning channel exists because DeepSeek models sometimes emit the
 * tool_calls markup inside the thinking field instead of the text field
 * (#19188): the turn then carries no visible text and no structured call, and
 * the runtime's "no visible output" retry loops forever. The same extraction
 * runs on both channels; extracted blocks are stripped from the channel they
 * arrived in and re-emitted as structured tool calls.
 */
interface DsmlChannel {
  onDelta(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>, partId: string, delta: string): void
  onEnd(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>, partId: string): void
}

function createDsmlChannel(
  deltaType: 'text-delta' | 'reasoning-delta',
  onExtracted: (count: number) => void
): DsmlChannel {
  let buffer = ''
  let dsmlBuffer = ''
  let inDsml = false

  // eslint-disable-next-line prefer-const
  let drainDsmlBuffer: (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>, partId: string) => void

  const enqueueRemainder = (
    controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
    partId: string
  ) => {
    const startIdx = buffer.indexOf(TOOL_CALLS_OPEN)
    if (startIdx === -1) {
      const partialIdx = findPartialPrefix(buffer, TOOL_CALLS_OPEN)
      if (partialIdx >= 0) {
        const safe = buffer.slice(0, partialIdx)
        if (safe) controller.enqueue({ type: deltaType, id: partId, delta: safe })
        buffer = buffer.slice(partialIdx)
      } else {
        if (buffer) controller.enqueue({ type: deltaType, id: partId, delta: buffer })
        buffer = ''
      }
      return
    }
    if (startIdx > 0) {
      controller.enqueue({ type: deltaType, id: partId, delta: buffer.slice(0, startIdx) })
    }
    dsmlBuffer = buffer.slice(startIdx + TOOL_CALLS_OPEN.length)
    buffer = ''
    inDsml = true
    drainDsmlBuffer(controller, partId)
  }

  drainDsmlBuffer = (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>, partId: string) => {
    const closeIdx = dsmlBuffer.indexOf(TOOL_CALLS_CLOSE)
    if (closeIdx === -1) {
      if (dsmlBuffer.length > SWALLOW_BUFFER_LIMIT) {
        logger.warn('DSML buffer exceeded limit without close tag, falling back to text')
        controller.enqueue({
          type: deltaType,
          id: partId,
          delta: TOOL_CALLS_OPEN + dsmlBuffer
        })
        dsmlBuffer = ''
        inDsml = false
      }
      return
    }

    const blockContent = dsmlBuffer.slice(0, closeIdx)
    const remainder = dsmlBuffer.slice(closeIdx + TOOL_CALLS_CLOSE.length)
    const calls = parseInvokeBlocks(blockContent)

    if (calls.length === 0) {
      logger.warn('DSML block closed but no invoke blocks parsed, emitting as text')
      controller.enqueue({
        type: deltaType,
        id: partId,
        delta: TOOL_CALLS_OPEN + blockContent + TOOL_CALLS_CLOSE
      })
    } else {
      enqueueToolCalls(controller, calls)
      onExtracted(calls.length)
      logger.info(`Parsed ${calls.length} DSML tool call(s)`, {
        channel: deltaType,
        tools: calls.map((c) => c.toolName)
      })
    }

    dsmlBuffer = ''
    inDsml = false
    buffer = remainder
    if (buffer) enqueueRemainder(controller, partId)
  }

  return {
    onDelta(controller, partId, delta) {
      if (inDsml) {
        dsmlBuffer += delta
        drainDsmlBuffer(controller, partId)
        return
      }
      buffer += delta
      enqueueRemainder(controller, partId)
    },
    onEnd(controller, partId) {
      if (inDsml) {
        logger.warn(`${deltaType} end with unclosed DSML block, flushing as text`)
        controller.enqueue({
          type: deltaType,
          id: partId,
          delta: TOOL_CALLS_OPEN + dsmlBuffer
        })
        dsmlBuffer = ''
        inDsml = false
      } else if (buffer) {
        controller.enqueue({ type: deltaType, id: partId, delta: buffer })
        buffer = ''
      }
    }
  }
}

function createDeepseekDsmlParserMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      let activeTextId: string | null = null
      let activeReasoningId: string | null = null
      let extractedToolCalls = false
      const markExtracted = (count: number) => {
        if (count > 0) extractedToolCalls = true
      }
      const textChannel = createDsmlChannel('text-delta', markExtracted)
      const reasoningChannel = createDsmlChannel('reasoning-delta', markExtracted)

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(
              chunk: LanguageModelV3StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
            ) {
              if (chunk.type === 'text-start') {
                activeTextId = chunk.id
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'text-end') {
                textChannel.onEnd(controller, chunk.id)
                controller.enqueue(chunk)
                activeTextId = null
                return
              }

              if (chunk.type === 'reasoning-start') {
                activeReasoningId = chunk.id
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'reasoning-delta') {
                if (!activeReasoningId) activeReasoningId = chunk.id
                reasoningChannel.onDelta(controller, chunk.id, chunk.delta)
                return
              }

              if (chunk.type === 'reasoning-end') {
                reasoningChannel.onEnd(controller, chunk.id)
                controller.enqueue(chunk)
                activeReasoningId = null
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

              if (chunk.type !== 'text-delta') {
                controller.enqueue(chunk)
                return
              }

              if (!activeTextId) activeTextId = chunk.id
              textChannel.onDelta(controller, chunk.id, chunk.delta)
            },
            flush(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) {
              // text-end / reasoning-end normally flush each channel; a stream
              // torn down between start and end still gets its remainder out.
              textChannel.onEnd(controller, activeTextId ?? 'dsml-fallback')
              if (activeReasoningId) reasoningChannel.onEnd(controller, activeReasoningId)
            }
          })
        ),
        ...rest
      }
    },

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      const newContent: typeof result.content = []
      let extracted = false

      for (const part of result.content) {
        // DSML can arrive on the text channel or inside the reasoning
        // (thinking) channel (#19188); both carry plain string content here.
        if (part.type !== 'text' && part.type !== 'reasoning') {
          newContent.push(part)
          continue
        }
        const text = part.text
        const partsForText: typeof newContent = []
        let textAccum = ''
        let cursor = 0
        let foundCallInPart = false

        while (cursor < text.length) {
          const startIdx = text.indexOf(TOOL_CALLS_OPEN, cursor)
          if (startIdx === -1) {
            textAccum += text.slice(cursor)
            break
          }
          const closeIdx = text.indexOf(TOOL_CALLS_CLOSE, startIdx + TOOL_CALLS_OPEN.length)
          if (closeIdx === -1) {
            textAccum += text.slice(cursor)
            break
          }

          const blockEnd = closeIdx + TOOL_CALLS_CLOSE.length
          const blockContent = text.slice(startIdx + TOOL_CALLS_OPEN.length, closeIdx)
          const calls = parseInvokeBlocks(blockContent)

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
 * Some DeepSeek deployments emit tool calls as `<｜｜DSML｜｜tool_calls>` markup inside text
 * deltas instead of native `tool-call` parts; this re-extracts them. The same markup can
 * also surface inside the thinking/reasoning channel (#19188), where without extraction
 * the turn produces no visible text and no structured call — the runtime's
 * "no visible output" retry then loops forever. The middleware passes text and reasoning
 * straight through unless that distinctive markup appears, so gating to DeepSeek models
 * is both sufficient (where the leak happens) and safe (no transform for non-DeepSeek).
 */
export const deepseekDsmlParserFeature: RequestFeature = {
  name: 'deepseek-dsml-parser',
  applies: (scope) => isDeepSeekModel(scope.model),
  contributeModelAdapters: () => [createDeepseekDsmlParserPlugin()]
}

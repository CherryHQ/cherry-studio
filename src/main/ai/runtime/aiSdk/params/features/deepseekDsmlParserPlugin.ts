import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isDeepSeekModel } from '@shared/utils/model'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'

const logger = loggerService.withContext('deepseekDsmlParser')

const DSML_DELIMITERS = [
  { open: '<｜｜DSML｜｜tool_calls>', close: '</｜｜DSML｜｜tool_calls>' },
  { open: '<｜DSML｜tool_calls>', close: '</｜DSML｜tool_calls>' }
] as const
const SWALLOW_BUFFER_LIMIT = 64 * 1024

const INVOKE_RE = /<｜{1,2}DSML｜{1,2}invoke\s+name="([^"]+)">([\s\S]*?)<\/｜{1,2}DSML｜{1,2}invoke>/g
const PARAM_RE =
  /<｜{1,2}DSML｜{1,2}parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)<\/｜{1,2}DSML｜{1,2}parameter>/g

type ContentKind = 'text' | 'reasoning'

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
function findPartialPrefix(buffer: string): number {
  let earliest = -1
  for (const { open } of DSML_DELIMITERS) {
    const maxLen = Math.min(buffer.length, open.length - 1)
    for (let len = maxLen; len > 0; len--) {
      if (open.startsWith(buffer.slice(buffer.length - len))) {
        const index = buffer.length - len
        if (earliest === -1 || index < earliest) earliest = index
        break
      }
    }
  }
  return earliest
}

function findOpeningTag(buffer: string) {
  let match: { index: number; open: string; close: string } | undefined
  for (const delimiters of DSML_DELIMITERS) {
    const index = buffer.indexOf(delimiters.open)
    if (index >= 0 && (!match || index < match.index)) match = { index, ...delimiters }
  }
  return match
}

function enqueueContentDelta(
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  kind: ContentKind,
  id: string,
  delta: string
) {
  controller.enqueue(kind === 'text' ? { type: 'text-delta', id, delta } : { type: 'reasoning-delta', id, delta })
}

function generateToolCallId(): string {
  return `dsml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function createDeepseekDsmlParserMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      let textBuffer = ''
      let dsmlBuffer = ''
      let inDsml = false
      let activeContent: { kind: ContentKind; id: string } | null = null
      let activeOpenTag: string = DSML_DELIMITERS[0].open
      let activeCloseTag: string = DSML_DELIMITERS[0].close
      let extractedToolCalls = false

      // eslint-disable-next-line prefer-const
      let drainDsmlBuffer: (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        kind: ContentKind,
        id: string
      ) => void

      const enqueueRemainderText = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        kind: ContentKind,
        id: string
      ) => {
        const openingTag = findOpeningTag(textBuffer)
        if (!openingTag) {
          const partialIdx = findPartialPrefix(textBuffer)
          if (partialIdx >= 0) {
            const safe = textBuffer.slice(0, partialIdx)
            if (safe) enqueueContentDelta(controller, kind, id, safe)
            textBuffer = textBuffer.slice(partialIdx)
          } else {
            if (textBuffer) enqueueContentDelta(controller, kind, id, textBuffer)
            textBuffer = ''
          }
          return
        }
        if (openingTag.index > 0) {
          enqueueContentDelta(controller, kind, id, textBuffer.slice(0, openingTag.index))
        }
        activeOpenTag = openingTag.open
        activeCloseTag = openingTag.close
        dsmlBuffer = textBuffer.slice(openingTag.index + openingTag.open.length)
        textBuffer = ''
        inDsml = true
        drainDsmlBuffer(controller, kind, id)
      }

      drainDsmlBuffer = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        kind: ContentKind,
        id: string
      ) => {
        const closeIdx = dsmlBuffer.indexOf(activeCloseTag)
        if (closeIdx === -1) {
          if (dsmlBuffer.length > SWALLOW_BUFFER_LIMIT) {
            logger.warn('DSML buffer exceeded limit without close tag, falling back to text')
            enqueueContentDelta(controller, kind, id, activeOpenTag + dsmlBuffer)
            dsmlBuffer = ''
            inDsml = false
          }
          return
        }

        const blockContent = dsmlBuffer.slice(0, closeIdx)
        const remainder = dsmlBuffer.slice(closeIdx + activeCloseTag.length)
        const calls = parseInvokeBlocks(blockContent)

        if (calls.length === 0) {
          logger.warn('DSML block closed but no invoke blocks parsed, emitting as text')
          enqueueContentDelta(controller, kind, id, activeOpenTag + blockContent + activeCloseTag)
        } else {
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
            tools: calls.map((c) => c.toolName)
          })
        }

        dsmlBuffer = ''
        inDsml = false
        textBuffer = remainder
        if (textBuffer) enqueueRemainderText(controller, kind, id)
      }

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(
              chunk: LanguageModelV3StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
            ) {
              if (chunk.type === 'text-start' || chunk.type === 'reasoning-start') {
                activeContent = { kind: chunk.type === 'text-start' ? 'text' : 'reasoning', id: chunk.id }
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'text-end' || chunk.type === 'reasoning-end') {
                const kind = chunk.type === 'text-end' ? 'text' : 'reasoning'
                const id = chunk.id
                if (inDsml) {
                  logger.warn('text-end with unclosed DSML block, flushing as text')
                  enqueueContentDelta(controller, kind, id, activeOpenTag + dsmlBuffer)
                  dsmlBuffer = ''
                  inDsml = false
                } else if (textBuffer) {
                  enqueueContentDelta(controller, kind, id, textBuffer)
                  textBuffer = ''
                }
                controller.enqueue(chunk)
                activeContent = null
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

              const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
              const id = chunk.id
              if (!activeContent) activeContent = { kind, id }

              if (inDsml) {
                dsmlBuffer += chunk.delta
                drainDsmlBuffer(controller, kind, id)
                return
              }

              textBuffer += chunk.delta
              enqueueRemainderText(controller, kind, id)
            },
            flush(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) {
              const { kind, id } = activeContent ?? { kind: 'text' as const, id: 'dsml-fallback' }
              if (inDsml) {
                logger.warn('Stream flushed with unclosed DSML block')
                enqueueContentDelta(controller, kind, id, activeOpenTag + dsmlBuffer)
              } else if (textBuffer) {
                enqueueContentDelta(controller, kind, id, textBuffer)
              }
              textBuffer = ''
              dsmlBuffer = ''
              inDsml = false
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
          const openingTag = findOpeningTag(text.slice(cursor))
          if (!openingTag) {
            textAccum += text.slice(cursor)
            break
          }
          const startIdx = cursor + openingTag.index
          const closeIdx = text.indexOf(openingTag.close, startIdx + openingTag.open.length)
          if (closeIdx === -1) {
            textAccum += text.slice(cursor)
            break
          }

          const blockEnd = closeIdx + openingTag.close.length
          const blockContent = text.slice(startIdx + openingTag.open.length, closeIdx)
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
 * Some DeepSeek deployments emit single- or double-bar DSML tool-call markup inside text or
 * reasoning content instead of native `tool-call` parts; this re-extracts complete calls. The
 * middleware passes content straight through unless that distinctive markup appears, so gating
 * to DeepSeek models is both sufficient (where the leak happens) and safe for other models.
 */
export const deepseekDsmlParserFeature: RequestFeature = {
  name: 'deepseek-dsml-parser',
  applies: (scope) => isDeepSeekModel(scope.model),
  contributeModelAdapters: () => [createDeepseekDsmlParserPlugin()]
}

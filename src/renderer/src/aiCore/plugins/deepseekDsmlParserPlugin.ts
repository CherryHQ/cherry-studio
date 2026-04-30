import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

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

function createDeepseekDsmlParserMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      let textBuffer = ''
      let dsmlBuffer = ''
      let inDsml = false
      let activeTextId: string | null = null
      let extractedToolCalls = false

      // eslint-disable-next-line prefer-const
      let drainDsmlBuffer: (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        textId: string
      ) => void

      const enqueueRemainderText = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        textId: string
      ) => {
        const startIdx = textBuffer.indexOf(TOOL_CALLS_OPEN)
        if (startIdx === -1) {
          const partialIdx = findPartialPrefix(textBuffer, TOOL_CALLS_OPEN)
          if (partialIdx >= 0) {
            const safe = textBuffer.slice(0, partialIdx)
            if (safe) controller.enqueue({ type: 'text-delta', id: textId, delta: safe })
            textBuffer = textBuffer.slice(partialIdx)
          } else {
            if (textBuffer) controller.enqueue({ type: 'text-delta', id: textId, delta: textBuffer })
            textBuffer = ''
          }
          return
        }
        if (startIdx > 0) {
          controller.enqueue({ type: 'text-delta', id: textId, delta: textBuffer.slice(0, startIdx) })
        }
        dsmlBuffer = textBuffer.slice(startIdx + TOOL_CALLS_OPEN.length)
        textBuffer = ''
        inDsml = true
        drainDsmlBuffer(controller, textId)
      }

      drainDsmlBuffer = (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>, textId: string) => {
        const closeIdx = dsmlBuffer.indexOf(TOOL_CALLS_CLOSE)
        if (closeIdx === -1) {
          if (dsmlBuffer.length > SWALLOW_BUFFER_LIMIT) {
            logger.warn('DSML buffer exceeded limit without close tag, falling back to text')
            controller.enqueue({
              type: 'text-delta',
              id: textId,
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

        if (calls.length > 0) {
          extractedToolCalls = true
          logger.info(`Parsed ${calls.length} DSML tool call(s)`, {
            tools: calls.map((c) => c.toolName)
          })
        } else {
          logger.warn('DSML block closed but no invoke blocks parsed')
        }

        dsmlBuffer = ''
        inDsml = false
        textBuffer = remainder
        if (textBuffer) enqueueRemainderText(controller, textId)
      }

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
                const textId = chunk.id
                if (inDsml) {
                  logger.warn('text-end with unclosed DSML block, flushing as text')
                  controller.enqueue({
                    type: 'text-delta',
                    id: textId,
                    delta: TOOL_CALLS_OPEN + dsmlBuffer
                  })
                  dsmlBuffer = ''
                  inDsml = false
                } else if (textBuffer) {
                  controller.enqueue({ type: 'text-delta', id: textId, delta: textBuffer })
                  textBuffer = ''
                }
                controller.enqueue(chunk)
                activeTextId = null
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

              const textId = chunk.id
              if (!activeTextId) activeTextId = textId

              if (inDsml) {
                dsmlBuffer += chunk.delta
                drainDsmlBuffer(controller, textId)
                return
              }

              textBuffer += chunk.delta
              enqueueRemainderText(controller, textId)
            },
            flush(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) {
              const textId = activeTextId ?? 'dsml-fallback'
              if (inDsml) {
                logger.warn('Stream flushed with unclosed DSML block')
                controller.enqueue({
                  type: 'text-delta',
                  id: textId,
                  delta: TOOL_CALLS_OPEN + dsmlBuffer
                })
              } else if (textBuffer) {
                controller.enqueue({ type: 'text-delta', id: textId, delta: textBuffer })
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
        if (part.type !== 'text') {
          newContent.push(part)
          continue
        }
        const text = part.text
        const startIdx = text.indexOf(TOOL_CALLS_OPEN)
        if (startIdx === -1) {
          newContent.push(part)
          continue
        }
        const closeIdx = text.indexOf(TOOL_CALLS_CLOSE, startIdx)
        if (closeIdx === -1) {
          newContent.push(part)
          continue
        }
        const before = text.slice(0, startIdx)
        const blockContent = text.slice(startIdx + TOOL_CALLS_OPEN.length, closeIdx)
        const after = text.slice(closeIdx + TOOL_CALLS_CLOSE.length)
        const calls = parseInvokeBlocks(blockContent)

        if (before) newContent.push({ ...part, text: before })
        for (const call of calls) {
          newContent.push({
            type: 'tool-call',
            toolCallId: generateToolCallId(),
            toolName: call.toolName,
            input: JSON.stringify(call.args)
          })
        }
        if (after) newContent.push({ ...part, text: after })
        if (calls.length > 0) extracted = true
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

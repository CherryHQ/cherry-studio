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

const INVOKE_RE = {
  double: /<｜｜DSML｜｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/g,
  single: /<｜DSML｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜DSML｜invoke>/g
} as const
const PARAM_RE = {
  double: /<｜｜DSML｜｜parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g,
  single: /<｜DSML｜parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)<\/｜DSML｜parameter>/g
} as const

type ContentKind = 'text' | 'reasoning'
type ContentProviderMetadata = Extract<LanguageModelV3StreamPart, { type: 'reasoning-delta' }>['providerMetadata']

interface StreamContentState {
  kind: ContentKind
  id: string
  textBuffer: string
  dsmlBuffer: string
  pendingToolCalls: ParsedDsmlCall[]
  pendingProviderMetadata?: ContentProviderMetadata
  inDsml: boolean
  activeOpenTag: string
  activeCloseTag: string
}

interface ParsedDsmlCall {
  toolName: string
  args: Record<string, unknown>
}

function parseInvokeBlocks(dsmlContent: string, outerOpenTag: string = DSML_DELIMITERS[0].open): ParsedDsmlCall[] {
  const calls: ParsedDsmlCall[] = []
  const variant = outerOpenTag === DSML_DELIMITERS[0].open ? 'double' : 'single'
  const invokeRe = INVOKE_RE[variant]
  const paramRe = PARAM_RE[variant]
  invokeRe.lastIndex = 0
  let invokeMatch: RegExpExecArray | null
  while ((invokeMatch = invokeRe.exec(dsmlContent)) !== null) {
    const toolName = invokeMatch[1]
    const inner = invokeMatch[2]
    const args: Record<string, unknown> = {}

    paramRe.lastIndex = 0
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRe.exec(inner)) !== null) {
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
  delta: string,
  providerMetadata?: ContentProviderMetadata
) {
  const chunk =
    kind === 'text' ? { type: 'text-delta' as const, id, delta } : { type: 'reasoning-delta' as const, id, delta }
  controller.enqueue(providerMetadata === undefined ? chunk : { ...chunk, providerMetadata })
}

function generateToolCallId(): string {
  return `dsml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function enqueueToolCalls(
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  calls: ParsedDsmlCall[]
) {
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

function enqueueStateDelta(
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  state: StreamContentState,
  delta: string
) {
  const providerMetadata = state.pendingProviderMetadata
  state.pendingProviderMetadata = undefined
  enqueueContentDelta(controller, state.kind, state.id, delta, providerMetadata)
}

function enqueuePendingStateMetadata(
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  state: StreamContentState
) {
  if (state.pendingProviderMetadata === undefined) return
  enqueueContentDelta(controller, state.kind, state.id, '', state.pendingProviderMetadata)
  state.pendingProviderMetadata = undefined
}

function createDeepseekDsmlParserMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      const contentStates = new Map<string, StreamContentState>()
      let extractedToolCalls = false

      const stateKey = (kind: ContentKind, id: string) => `${kind}:${id}`
      const getContentState = (kind: ContentKind, id: string) => {
        const key = stateKey(kind, id)
        let state = contentStates.get(key)
        if (!state) {
          state = {
            kind,
            id,
            textBuffer: '',
            dsmlBuffer: '',
            pendingToolCalls: [],
            inDsml: false,
            activeOpenTag: DSML_DELIMITERS[0].open,
            activeCloseTag: DSML_DELIMITERS[0].close
          }
          contentStates.set(key, state)
        }
        return state
      }

      // eslint-disable-next-line prefer-const
      let drainDsmlBuffer: (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        state: StreamContentState
      ) => void

      const enqueueRemainderText = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        state: StreamContentState
      ) => {
        const openingTag = findOpeningTag(state.textBuffer)
        if (!openingTag) {
          const partialIdx = findPartialPrefix(state.textBuffer)
          if (partialIdx >= 0) {
            const safe = state.textBuffer.slice(0, partialIdx)
            if (safe) enqueueStateDelta(controller, state, safe)
            state.textBuffer = state.textBuffer.slice(partialIdx)
          } else {
            if (state.textBuffer) enqueueStateDelta(controller, state, state.textBuffer)
            state.textBuffer = ''
          }
          return
        }
        if (openingTag.index > 0) {
          enqueueStateDelta(controller, state, state.textBuffer.slice(0, openingTag.index))
        }
        state.activeOpenTag = openingTag.open
        state.activeCloseTag = openingTag.close
        state.dsmlBuffer = state.textBuffer.slice(openingTag.index + openingTag.open.length)
        state.textBuffer = ''
        state.inDsml = true
        drainDsmlBuffer(controller, state)
      }

      drainDsmlBuffer = (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
        state: StreamContentState
      ) => {
        const closeIdx = state.dsmlBuffer.indexOf(state.activeCloseTag)
        if (closeIdx === -1) {
          if (state.dsmlBuffer.length > SWALLOW_BUFFER_LIMIT) {
            logger.warn('DSML buffer exceeded limit without close tag, falling back to text')
            enqueueStateDelta(controller, state, state.activeOpenTag + state.dsmlBuffer)
            state.dsmlBuffer = ''
            state.inDsml = false
          }
          return
        }

        const blockContent = state.dsmlBuffer.slice(0, closeIdx)
        const remainder = state.dsmlBuffer.slice(closeIdx + state.activeCloseTag.length)
        const calls = parseInvokeBlocks(blockContent, state.activeOpenTag)

        if (calls.length === 0) {
          logger.warn('DSML block closed but no invoke blocks parsed, emitting as text')
          enqueueStateDelta(controller, state, state.activeOpenTag + blockContent + state.activeCloseTag)
        } else {
          // A tool call extracted from a reasoning block must not overtake the
          // block's reasoning-end event. Anthropic content blocks are ordered;
          // emitting tool_use while thinking is still open yields an invalid
          // request at the gateway. Text blocks can keep the historical
          // streaming behavior, while reasoning calls are released at end.
          if (state.kind === 'reasoning') state.pendingToolCalls.push(...calls)
          else enqueueToolCalls(controller, calls)
          extractedToolCalls = true
          logger.info(`Parsed ${calls.length} DSML tool call(s)`, {
            tools: calls.map((c) => c.toolName)
          })
        }

        state.dsmlBuffer = ''
        state.inDsml = false
        state.textBuffer = remainder
        if (state.textBuffer) enqueueRemainderText(controller, state)
      }

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(
              chunk: LanguageModelV3StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
            ) {
              if (chunk.type === 'text-start' || chunk.type === 'reasoning-start') {
                getContentState(chunk.type === 'text-start' ? 'text' : 'reasoning', chunk.id)
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'text-end' || chunk.type === 'reasoning-end') {
                const kind = chunk.type === 'text-end' ? 'text' : 'reasoning'
                const id = chunk.id
                const key = stateKey(kind, id)
                const state = contentStates.get(key)
                if (state?.inDsml) {
                  logger.warn('text-end with unclosed DSML block, flushing as text')
                  enqueueStateDelta(controller, state, state.activeOpenTag + state.dsmlBuffer)
                } else if (state?.textBuffer) {
                  enqueueStateDelta(controller, state, state.textBuffer)
                }
                if (state) enqueuePendingStateMetadata(controller, state)
                controller.enqueue(chunk)
                if (state?.pendingToolCalls.length) {
                  enqueueToolCalls(controller, state.pendingToolCalls)
                  state.pendingToolCalls = []
                }
                contentStates.delete(key)
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
              const state = getContentState(kind, id)

              if (chunk.providerMetadata !== undefined) {
                if (chunk.delta === '') {
                  controller.enqueue(chunk)
                  return
                }
                state.pendingProviderMetadata = chunk.providerMetadata
              }

              if (state.inDsml) {
                state.dsmlBuffer += chunk.delta
                drainDsmlBuffer(controller, state)
                return
              }

              state.textBuffer += chunk.delta
              enqueueRemainderText(controller, state)
            },
            flush(controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) {
              for (const state of contentStates.values()) {
                if (state.inDsml) {
                  logger.warn('Stream flushed with unclosed DSML block')
                  enqueueStateDelta(controller, state, state.activeOpenTag + state.dsmlBuffer)
                } else if (state.textBuffer) {
                  enqueueStateDelta(controller, state, state.textBuffer)
                }
                enqueuePendingStateMetadata(controller, state)
                if (state.pendingToolCalls.length) enqueueToolCalls(controller, state.pendingToolCalls)
              }
              contentStates.clear()
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
          const calls = parseInvokeBlocks(blockContent, openingTag.open)

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
 * reasoning content instead of native `tool-call` parts; this re-extracts complete calls for
 * AI SDK requests, including Agent traffic routed through Cherry's local API gateway. Direct
 * Claude Agent SDK and native DSH transports do not install AI SDK model middleware. The parser
 * passes content straight through unless that distinctive markup appears, so gating to DeepSeek
 * models is both sufficient (where the leak happens) and safe for other models.
 */
export const deepseekDsmlParserFeature: RequestFeature = {
  name: 'deepseek-dsml-parser',
  applies: (scope) => isDeepSeekModel(scope.model),
  contributeModelAdapters: () => [createDeepseekDsmlParserPlugin()]
}

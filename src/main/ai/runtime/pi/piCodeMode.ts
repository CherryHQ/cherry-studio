import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { runExecCode } from '@main/ai/tools/codeMode/runtime'
import { toolsToTypeScript, toolToTypeScript } from '@main/ai/tools/codeMode/schemaToTypeScript'
import {
  PI_TOOL_CALL_TOOL_NAME,
  PI_TOOL_DESCRIBE_TOOL_NAME,
  PI_TOOL_EXEC_TOOL_NAME,
  PI_TOOL_SEARCH_TOOL_NAME
} from '@shared/ai/piBuiltinTools'

import type { PiToolAuthorizationRequest, PiToolAuthorizer } from './approvalExtension'
import type { PiMcpToolDefinition } from './piMcpToolAdapter'

type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>
type InvokedToolResult = { raw: ToolResult; value: unknown }
type SerializedAuthorizer = (request: PiToolAuthorizationRequest) => ReturnType<PiToolAuthorizer>

const SEARCH_RESULT_LIMIT = 20
const BM25_K1 = 1.2
const BM25_B = 0.75

const searchParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'BM25 query matched against tool names and descriptions.'
    }
  },
  additionalProperties: false
} as ToolDefinition['parameters']

const describeParameters = {
  type: 'object',
  properties: { name: { type: 'string', description: 'Exact tool name returned by tool_search.' } },
  required: ['name'],
  additionalProperties: false
} as ToolDefinition['parameters']

const callParameters = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Exact tool name returned by tool_search.' },
    params: { type: 'object', description: 'Arguments matching the tool schema.' }
  },
  required: ['name', 'params'],
  additionalProperties: false
} as ToolDefinition['parameters']

const execParameters = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description:
        'JavaScript body executed inside an async function. Call tools with tools.invoke(name, params), and explicitly return the final value.'
    }
  },
  required: ['code'],
  additionalProperties: false
} as ToolDefinition['parameters']

export function createPiCodeModeTools(
  tools: readonly PiMcpToolDefinition[],
  isDisabled: (toolName: string) => boolean,
  authorizeTool: PiToolAuthorizer
): ToolDefinition[] {
  const catalog = new Map(tools.map((tool) => [tool.name, tool]))
  const invokeTargetTool = async (
    executionToolCallId: string,
    approvalToolCallId: string,
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onApprovalPending?: () => () => void,
    authorizer: SerializedAuthorizer = authorizeTool
  ): Promise<InvokedToolResult> => {
    const tool = catalog.get(name)
    if (!tool) throw new Error(`Tool not found: ${name}`)
    const decision = await authorizer({
      toolName: name,
      toolCallId: approvalToolCallId,
      input,
      signal,
      onApprovalPending
    })
    if (decision?.block) throw new Error(decision.reason)
    const raw = await tool.execute(executionToolCallId, input, signal, undefined, {} as never)
    return { raw, value: decodeToolResult(raw, tool.outputSchema, name) }
  }

  const searchTool: ToolDefinition = {
    name: PI_TOOL_SEARCH_TOOL_NAME,
    label: 'Search tools',
    description:
      'Search the available tool catalog. Returns matching tools as TypeScript declarations for use with tool_exec.',
    promptSnippet: 'Search available tools and read their TypeScript signatures',
    parameters: searchParameters,
    async execute(_toolCallId, params) {
      const input = params as Record<string, unknown>
      const query = typeof input.query === 'string' ? input.query : ''
      const matches = rankTools(
        [...catalog.values()].filter((tool) => !isDisabled(tool.name)),
        query
      )
        .slice(0, SEARCH_RESULT_LIMIT)
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          declaration: toolToTypeScript(
            tool.name,
            tool.description,
            tool.parameters,
            catalog.get(tool.name)?.outputSchema
          )
        }))

      const text =
        matches.length > 0
          ? toolsToTypeScript(
              matches.map((match) => ({
                name: match.name,
                description: match.description,
                inputSchema: catalog.get(match.name)?.parameters,
                outputSchema: catalog.get(match.name)?.outputSchema
              }))
            )
          : 'No tools matched. Broaden the query or omit it.'
      return {
        content: [{ type: 'text', text }],
        details: { matchedNamespaces: matches.length > 0 ? [{ namespace: 'pi', tools: matches }] : [] }
      }
    }
  }

  const describeTool: ToolDefinition = {
    name: PI_TOOL_DESCRIBE_TOOL_NAME,
    label: 'Describe tool',
    description: 'Get the complete description and TypeScript signature for one discovered tool.',
    promptSnippet: 'Get the full description and TypeScript signature for a tool',
    parameters: describeParameters,
    async execute(_toolCallId, params) {
      const input = params as Record<string, unknown>
      const name = typeof input.name === 'string' ? input.name : ''
      const tool = catalog.get(name)
      if (!tool || isDisabled(name)) throw new Error(`Tool not found: ${name}`)
      return {
        content: [
          {
            type: 'text',
            text: `${tool.description}\n\n${toolToTypeScript(tool.name, tool.description, tool.parameters, tool.outputSchema)}`
          }
        ],
        details: {
          name: tool.name,
          declaration: toolToTypeScript(tool.name, tool.description, tool.parameters, tool.outputSchema)
        }
      }
    }
  }

  const callTool: ToolDefinition = {
    name: PI_TOOL_CALL_TOOL_NAME,
    label: 'Call tool',
    description: 'Call one discovered tool with parameters matching its schema.',
    promptSnippet: 'Call one discovered tool directly',
    parameters: callParameters,
    async execute(toolCallId, params, signal) {
      const input = params as Record<string, unknown>
      const name = typeof input.name === 'string' ? input.name : ''
      const toolParams = isRecord(input.params) ? input.params : {}
      return (await invokeTargetTool(`${toolCallId}::call`, toolCallId, name, toolParams, signal)).raw
    }
  }

  const execTool: ToolDefinition = {
    name: PI_TOOL_EXEC_TOOL_NAME,
    label: 'Execute tool code',
    description:
      'Execute JavaScript that orchestrates discovered tools. Use tool_search first, call tools.invoke(name, params), and explicitly return the final value.',
    promptSnippet: 'Execute JavaScript that orchestrates multiple tools',
    promptGuidelines: [
      'Use tool_search before tool_exec when you do not already know the exact tool name and TypeScript signature.',
      'tool_exec runs JavaScript, not TypeScript syntax. Explicitly return the final value.'
    ],
    parameters: execParameters,
    async execute(toolCallId, params, signal) {
      const input = params as Record<string, unknown>
      const code = typeof input.code === 'string' ? input.code : ''
      let pauseExecutionTimeout: (() => void) | undefined
      let resumeExecutionTimeout: (() => void) | undefined
      const serializeAuthorization = createSerializedAuthorizer(authorizeTool)
      const result = await runExecCode(code, {
        abortSignal: signal,
        onExecutionStarted({ pauseTimeout, resumeTimeout }) {
          pauseExecutionTimeout = pauseTimeout
          resumeExecutionTimeout = resumeTimeout
        },
        async executeTool(name, input, requestId, childSignal) {
          const nestedToolCallId = `${toolCallId}::exec::${requestId}`
          return (
            await invokeTargetTool(
              nestedToolCallId,
              toolCallId,
              name,
              input,
              childSignal,
              () => {
                pauseExecutionTimeout?.()
                return () => resumeExecutionTimeout?.()
              },
              serializeAuthorization
            )
          ).value
        }
      })

      return toPiResult(result)
    }
  }

  return [searchTool, describeTool, callTool, execTool]
}

function rankTools(tools: readonly ToolDefinition[], query: string): ToolDefinition[] {
  const terms = tokenize(query)
  if (terms.length === 0) return [...tools]
  const documents = tools.map((tool) => tokenize(`${tool.name} ${tool.description}`))
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1
  return tools
    .map((tool, index) => {
      const document = documents[index]
      const score = terms.reduce((total, term) => {
        const frequency = document.filter((token) => token === term).length
        if (frequency === 0) return total
        const containingDocuments = documents.filter((candidate) => candidate.includes(term)).length
        const idf = Math.log(1 + (documents.length - containingDocuments + 0.5) / (containingDocuments + 0.5))
        return (
          total +
          (idf * frequency * (BM25_K1 + 1)) /
            (frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.length / averageLength)))
        )
      }, 0)
      return { tool, score }
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .map(({ tool }) => tool)
}

function tokenize(value: string): string[] {
  const normalized = value
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
    .toLowerCase()
  return [...new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? [])]
}

function createSerializedAuthorizer(authorizer: PiToolAuthorizer): SerializedAuthorizer {
  let tail = Promise.resolve()
  return async (request) => {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      if (request.signal?.aborted) {
        const reason = request.signal.reason
        throw reason instanceof Error ? reason : new Error(reason === undefined ? 'tool_exec aborted' : String(reason))
      }
      return await authorizer(request)
    } finally {
      release()
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeToolResult(result: ToolResult, outputSchema: unknown, toolName: string): unknown {
  if (!outputSchema) return result
  if (result.details !== undefined) return result.details

  const textContent = result.content.filter((part) => part.type === 'text')
  if (textContent.length === 0) {
    throw new Error(`Tool ${toolName} declared an output schema but returned no text content or structuredContent.`)
  }

  const text = textContent.map((part) => part.text).join('\n')
  if (isStringSchema(outputSchema)) return text

  try {
    return JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Tool ${toolName} declared a structured output but returned invalid JSON: ${message}`)
  }
}

function isStringSchema(schema: unknown): boolean {
  return isRecord(schema) && schema.type === 'string'
}

function toPiResult(result: { result: unknown; logs?: string[]; error?: string; isError?: boolean }): ToolResult {
  if (result.isError) {
    throw new Error(withLogs(result.error ?? 'tool_exec failed', result.logs))
  }

  if (result.result === undefined) {
    throw new Error(withLogs('tool_exec returned no value; add an explicit return', result.logs))
  }

  let output: string
  try {
    output = stringifyOutput(result.result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(withLogs(message, result.logs))
  }
  return {
    content: [{ type: 'text', text: output }],
    details: { result: JSON.parse(output), logs: result.logs }
  }
}

function stringifyOutput(value: unknown): string {
  try {
    const output = JSON.stringify(value, (_key, nested) => (typeof nested === 'bigint' ? nested.toString() : nested), 2)
    if (output === undefined) throw new Error('result is not JSON-serializable')
    return output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`tool_exec result must be JSON-serializable: ${message}`)
  }
}

function withLogs(message: string, logs: string[] | undefined): string {
  const output = logs?.join('\n')
  return [message, output].filter(Boolean).join('\n\nLogs:\n')
}

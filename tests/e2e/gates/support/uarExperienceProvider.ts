import { existsSync, readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'

const OUTPUT_NAME = 'gate-v-approved.txt'
const OUTPUT_MARKER = 'Gate V approved filesystem operation.'

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content)
  } catch {
    return ''
  }
}

function reportsToolError(content: unknown): boolean {
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>
    if (record.isError === true || record.is_error === true) return true
  }

  const text = toolResultText(content).trim()
  if (!text) return true
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (record.isError === true || record.is_error === true || record.error) return true
    }
  } catch {
    // Plain-text tool results are valid. Check their explicit failure markers below.
  }
  return /(?:^|\b)(?:tool execution failed|invalid params|error:|failed to write)(?:\b|$)/i.test(text)
}

function rejectToolResult(response: ServerResponse, message: string): void {
  response.writeHead(422, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message } }))
}

export function sendGateVCompletion(
  response: ServerResponse,
  model: string,
  body: Record<string, any>,
  workspace: string
): void {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const tools = Array.isArray(body.tools) ? body.tools : []
  const toolMessages = messages.filter((message: any) => message?.role === 'tool')
  const afterTool = toolMessages.length > 0
  const writeTool = tools.find((tool: any) => tool?.function?.name?.endsWith('__write_file'))?.function?.name

  if (afterTool) {
    const failedResult = toolMessages.find((message: any) => reportsToolError(message?.content))
    if (failedResult) {
      rejectToolResult(response, 'Gate V fixture rejected an error tool result')
      return
    }
    const output = join(workspace, OUTPUT_NAME)
    if (!existsSync(output) || !readFileSync(output, 'utf8').includes(OUTPUT_MARKER)) {
      rejectToolResult(response, 'Gate V fixture refused to narrate success before the filesystem effect existed')
      return
    }
  }

  const delta =
    !afterTool && writeTool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'gate-v-write',
              type: 'function',
              function: {
                name: writeTool,
                arguments: JSON.stringify({
                  path: OUTPUT_NAME,
                  content: `${OUTPUT_MARKER}\n`
                })
              }
            }
          ]
        }
      : { role: 'assistant', content: 'Gate V completed after the approved filesystem operation.' }
  const finishReason = !afterTool && writeTool ? 'tool_calls' : 'stop'
  const chunk = (value: Record<string, unknown>, finish_reason: string | null) =>
    `data: ${JSON.stringify({
      id: 'gate-v-completion',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: value, finish_reason }]
    })}\n\n`
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  response.write(chunk(delta, null))
  response.write(chunk({}, finishReason))
  response.end('data: [DONE]\n\n')
}

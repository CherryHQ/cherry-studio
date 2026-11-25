import { randomUUID } from 'node:crypto'

import type { CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod'

import type { SDKCustomTool } from '@cherrystudio/agent-runtime-cursor'
import {
  editToolDefinition,
  globToolDefinition,
  grepToolDefinition,
  handleEditTool,
  handleGlobTool,
  handleGrepTool,
  handleLsTool,
  handleReadTool,
  handleWriteTool,
  lsToolDefinition,
  readToolDefinition,
  writeToolDefinition
} from '@main/ai/mcp/servers/filesystem/tools'
import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { crossPlatformSpawn, terminateProcessTree } from '@main/utils/processRunner'

type WorkspaceToolHost = {
  cwd: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  isReadOnly(): boolean
  start(id: string, name: string, input: Record<string, unknown>): void
  approve(id: string, name: string, input: Record<string, unknown>): Promise<DispatchDecision>
  finish(id: string, text: string, failed: boolean): void
}

const commandDefinition = {
  description: 'Execute a program with the given argument list in the session workspace.',
  inputSchema: z.object({ command: z.string().min(1), args: z.array(z.string()) })
}

async function executeProgram(input: z.infer<typeof commandDefinition.inputSchema>, host: WorkspaceToolHost) {
  const overflow = new AbortController()
  const signal = AbortSignal.any([host.signal, AbortSignal.timeout(120_000), overflow.signal])
  signal.throwIfAborted()
  const child = crossPlatformSpawn(input.command, input.args, {
    cwd: host.cwd,
    env: host.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const chunks: Buffer[] = []
  let bytes = 0
  const collect = (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes <= 1024 * 1024) chunks.push(chunk)
    else overflow.abort(new Error('Command output exceeded 1 MiB'))
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  return new Promise<string>((resolve, reject) => {
    const stop = () => {
      void terminateProcessTree(child, true, 'Cursor command').catch(reject)
    }
    signal.addEventListener('abort', stop, { once: true })
    child.once('error', reject)
    child.once('close', (code) => {
      signal.removeEventListener('abort', stop)
      const text = Buffer.concat(chunks).toString('utf8')
      if (signal.aborted) reject(signal.reason)
      else if (code !== 0) reject(new Error(text || `Command exited with code ${code}`))
      else resolve(text)
    })
  })
}

function textResult(result: CallToolResult) {
  const text = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
  if (result.isError) throw new Error(text)
  return text
}

export function cursorWorkspaceTools(host: WorkspaceToolHost): Record<string, SDKCustomTool> {
  function tool<I extends Record<string, unknown>>(
    name: 'Read' | 'List' | 'Glob' | 'Grep' | 'Edit' | 'Write' | 'Execute',
    definition: { description: string; inputSchema: z.ZodType<I> },
    execute: (input: I, cwd: string) => Promise<CallToolResult | string>
  ): SDKCustomTool {
    return {
      description: `${definition.description} Workspace directory: ${host.cwd}.`,
      inputSchema: z.record(z.string(), z.json()).parse(z.toJSONSchema(definition.inputSchema)),
      async execute(args, context) {
        host.signal.throwIfAborted()
        const id = context.toolCallId || randomUUID()
        let input = definition.inputSchema.parse(args)
        try {
          if (name === 'Write' || name === 'Edit' || name === 'Execute') {
            if (host.isReadOnly()) throw new Error('This session is read-only')
            const answer = await host.approve(id, name, input)
            host.signal.throwIfAborted()
            if (host.isReadOnly()) throw new Error('This session is read-only')
            if (!answer.approved) throw new Error(answer.reason || 'Tool execution denied')
            if (answer.updatedInput) input = definition.inputSchema.parse(answer.updatedInput)
          } else host.start(id, name, input)
          host.signal.throwIfAborted()
          const result = await execute(input, host.cwd)
          const text = typeof result === 'string' ? result : textResult(result)
          if (!host.signal.aborted) host.finish(id, text, false)
          return text
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          if (!host.signal.aborted) host.finish(id, text, true)
          return { isError: true, content: [{ type: 'text', text }] }
        }
      }
    }
  }

  return {
    read: tool('Read', readToolDefinition, handleReadTool),
    list: tool('List', lsToolDefinition, handleLsTool),
    glob: tool('Glob', globToolDefinition, handleGlobTool),
    grep: tool('Grep', grepToolDefinition, handleGrepTool),
    edit: tool('Edit', editToolDefinition, handleEditTool),
    write: tool('Write', writeToolDefinition, handleWriteTool),
    execute: tool('Execute', commandDefinition, (input) => executeProgram(input, host))
  }
}

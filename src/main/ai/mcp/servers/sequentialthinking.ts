// Sequential Thinking MCP Server
// port https://github.com/modelcontextprotocol/servers/blob/main/src/sequentialthinking/index.ts

import { randomUUID } from 'node:crypto'

import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
// Fixed chalk import for ESM
import chalk from 'chalk'
import * as z from 'zod'

import { loggerService } from '@logger'

import type { BuiltinMcpEndpoint } from './factory'

const logger = loggerService.withContext('McpServer:SequentialThinking')

const ThoughtDataSchema = z.object({
  chainId: z
    .string()
    .min(1)
    .optional()
    .describe('Identifier returned by the first thought; required for every continuation of that chain'),
  thought: z.string().min(1).describe('Your current thinking step'),
  nextThoughtNeeded: z.boolean().describe('Whether another thought step is needed'),
  thoughtNumber: z.number().int().min(1).describe('Current thought number'),
  totalThoughts: z.number().int().min(1).describe('Estimated total thoughts needed'),
  isRevision: z.boolean().optional().describe('Whether this revises previous thinking'),
  revisesThought: z.number().int().min(1).optional().describe('Which thought is being reconsidered'),
  branchFromThought: z.number().int().min(1).optional().describe('Branching point thought number'),
  branchId: z.string().optional().describe('Branch identifier'),
  needsMoreThoughts: z.boolean().optional().describe('If more thoughts are needed')
})

type ThoughtData = z.infer<typeof ThoughtDataSchema>

class ThoughtProcessor {
  private readonly chains = new Map<string, { history: ThoughtData[]; branches: Map<string, ThoughtData[]> }>()

  public close(): void {
    this.chains.clear()
  }

  private formatThought(thoughtData: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } =
      thoughtData

    let prefix: string
    let context: string

    if (isRevision) {
      prefix = chalk.yellow('🔄 Revision')
      context = ` (revising thought ${revisesThought})`
    } else if (branchFromThought) {
      prefix = chalk.green('🌿 Branch')
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`
    } else {
      prefix = chalk.blue('💭 Thought')
      context = ''
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`
    const border = '─'.repeat(Math.max(header.length, thought.length) + 4)

    return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`
  }

  public processThought(validatedInput: ThoughtData): CallToolResult {
    const chainId = validatedInput.chainId ?? randomUUID()
    let chain = this.chains.get(chainId)
    if (!chain) {
      if (validatedInput.chainId) throw new Error('Unknown or completed chainId. Start a new chain without chainId.')
      if (validatedInput.thoughtNumber !== 1)
        throw new Error('Start a new chain with thoughtNumber 1, or pass its chainId.')
      chain = { history: [], branches: new Map() }
      this.chains.set(chainId, chain)
    }

    if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
      validatedInput.totalThoughts = validatedInput.thoughtNumber
    }

    chain.history.push(validatedInput)

    if (validatedInput.branchFromThought && validatedInput.branchId) {
      const branch = chain.branches.get(validatedInput.branchId) ?? []
      branch.push(validatedInput)
      chain.branches.set(validatedInput.branchId, branch)
    }

    const formattedThought = this.formatThought(validatedInput)
    logger.error(formattedThought)
    if (!validatedInput.nextThoughtNeeded) this.chains.delete(chainId)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              chainId,
              thought: validatedInput.thought,
              thoughtNumber: validatedInput.thoughtNumber,
              totalThoughts: validatedInput.totalThoughts,
              nextThoughtNeeded: validatedInput.nextThoughtNeeded,
              branches: [...chain.branches.keys()],
              thoughtHistoryLength: chain.history.length
            },
            null,
            2
          )
        }
      ]
    }
  }
}

const SEQUENTIAL_THINKING_DESCRIPTION = `Step-by-step reasoning in thoughts. Start at thought 1 with no chainId; set nextThoughtNeeded false to end.`

/** Builtin sequential-thinking endpoint; thought chains are shared across its protocol instances. */
export function createSequentialThinkingEndpoint(): BuiltinMcpEndpoint {
  const thinking = new ThoughtProcessor()
  return {
    createServer: () => {
      const server = new McpServer({ name: 'sequential-thinking-server', version: '0.2.0' })
      server.registerTool(
        'sequentialthinking',
        { description: SEQUENTIAL_THINKING_DESCRIPTION, inputSchema: ThoughtDataSchema },
        (args) => thinking.processThought(args)
      )
      return server
    },
    close: async () => thinking.close()
  }
}

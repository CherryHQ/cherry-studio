// Sequential Thinking MCP Server
// port https://github.com/modelcontextprotocol/servers/blob/main/src/sequentialthinking/index.ts

import { randomUUID } from 'node:crypto'

import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
// Fixed chalk import for ESM
import chalk from 'chalk'
import * as z from 'zod'

import { loggerService } from '@logger'

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

class SequentialThinkingServer {
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

const SEQUENTIAL_THINKING_DESCRIPTION = `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.
Start a chain with thoughtNumber 1 and no chainId. Pass the returned chainId on every subsequent thought.
Setting nextThoughtNeeded to false completes and releases that chain; its identifier cannot be reused.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer

Parameters explained:
- thought: Your current thinking step, which can include:
* Regular analytical steps
* Revisions of previous thoughts
* Questions about previous decisions
* Realizations about needing more analysis
* Changes in approach
* Hypothesis generation
* Hypothesis verification
- next_thought_needed: True if you need more thinking, even if at what seemed like the end
- thought_number: Current number in sequence (can go beyond initial total if needed)
- total_thoughts: Current estimate of thoughts needed (can be adjusted up/down)
- is_revision: A boolean indicating if this thought revises previous thinking
- revises_thought: If is_revision is true, which thought number is being reconsidered
- branch_from_thought: If branching, which thought number is the branching point
- branch_id: Identifier for the current branch (if any)
- needs_more_thoughts: If reaching end but realizing more thoughts needed

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate a solution hypothesis when appropriate
8. Verify the hypothesis based on the Chain of Thought steps
9. Repeat the process until satisfied with the solution
10. Provide a single, ideally correct answer as the final output
11. Only set next_thought_needed to false when truly done and a satisfactory answer is reached`

class ThinkingServer {
  private readonly thinkingServer = new SequentialThinkingServer()

  public close(): void {
    this.thinkingServer.close()
  }

  public createServer(): McpServer {
    const server = new McpServer({
      name: 'sequential-thinking-server',
      version: '0.2.0'
    })
    server.registerTool(
      'sequentialthinking',
      { description: SEQUENTIAL_THINKING_DESCRIPTION, inputSchema: ThoughtDataSchema },
      (args) => this.thinkingServer.processThought(args)
    )
    return server
  }
}

export default ThinkingServer

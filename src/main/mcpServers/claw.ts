import { loggerService } from '@logger'
import { channelManager } from '@main/services/agents/services/channels/ChannelManager'
import { taskService } from '@main/services/agents/services/TaskService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { TaskContextMode, TaskScheduleType } from '@types'

const logger = loggerService.withContext('MCPServer:Claw')

/**
 * Parse a human-friendly duration string (e.g. '30m', '2h', '1h30m') into minutes.
 */
function parseDurationToMinutes(duration: string): number {
  let totalMinutes = 0
  const hourMatch = duration.match(/(\d+)\s*h/i)
  const minMatch = duration.match(/(\d+)\s*m/i)

  if (hourMatch) totalMinutes += parseInt(hourMatch[1], 10) * 60
  if (minMatch) totalMinutes += parseInt(minMatch[1], 10)

  if (totalMinutes === 0) {
    const raw = parseInt(duration, 10)
    if (!isNaN(raw) && raw > 0) return raw
    throw new Error(`Invalid duration: "${duration}". Use formats like '30m', '2h', '1h30m'.`)
  }

  return totalMinutes
}

const CRON_TOOL: Tool = {
  name: 'cron',
  description:
    "Manage scheduled tasks. Use action 'add' to create a recurring or one-time job, 'list' to see all jobs, or 'remove' to delete a job. For one-time jobs, use the 'at' field with an RFC3339 timestamp.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'remove'],
        description: 'The action to perform'
      },
      name: {
        type: 'string',
        description: 'Name of the job (required for add)'
      },
      message: {
        type: 'string',
        description: 'The prompt/instruction to execute on schedule (required for add)'
      },
      cron: {
        type: 'string',
        description: "Cron expression, e.g. '0 9 * * 1-5' for weekdays at 9am (use cron OR every, not both)"
      },
      every: {
        type: 'string',
        description: "Duration, e.g. '30m', '2h', '24h' (use every OR cron, not both)"
      },
      at: {
        type: 'string',
        description:
          "RFC3339 timestamp for a one-time job, e.g. '2024-01-15T14:30:00+08:00' (use at OR cron OR every, not combined)"
      },
      session_mode: {
        type: 'string',
        enum: ['reuse', 'new'],
        description:
          "Session behavior: 'reuse' (default) keeps conversation history across executions, 'new' starts a fresh session each time"
      },
      id: {
        type: 'string',
        description: 'Job ID (required for remove)'
      }
    },
    required: ['action']
  }
}

const NOTIFY_TOOL: Tool = {
  name: 'notify',
  description:
    'Send a notification message to the user through connected channels (e.g. Telegram). Use this to proactively inform the user about task results, status updates, or any important information.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The notification message to send to the user'
      },
      channel_id: {
        type: 'string',
        description: 'Optional: send to a specific channel only (omit to send to all notify-enabled channels)'
      }
    },
    required: ['message']
  }
}

class ClawServer {
  public server: Server
  private agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
    this.server = new Server(
      {
        name: 'claw',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [CRON_TOOL, NOTIFY_TOOL]
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        switch (toolName) {
          case 'cron': {
            const action = args.action
            switch (action) {
              case 'add':
                return await this.addJob(args)
              case 'list':
                return await this.listJobs()
              case 'remove':
                return await this.removeJob(args)
              default:
                throw new McpError(ErrorCode.InvalidParams, `Unknown action "${action}", expected add/list/remove`)
            }
          }
          case 'notify':
            return await this.sendNotification(args)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { agentId: this.agentId, error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async addJob(args: Record<string, string | undefined>) {
    const name = args.name
    const message = args.message
    const cronExpr = args.cron
    const every = args.every
    const at = args.at
    const sessionMode = args.session_mode

    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for add")
    if (!message) throw new McpError(ErrorCode.InvalidParams, "'message' is required for add")

    // Determine schedule type and value
    const scheduleCount = [cronExpr, every, at].filter(Boolean).length
    if (scheduleCount === 0) throw new McpError(ErrorCode.InvalidParams, "One of 'cron', 'every', or 'at' is required")
    if (scheduleCount > 1) throw new McpError(ErrorCode.InvalidParams, "Use only one of 'cron', 'every', or 'at'")

    let scheduleType: TaskScheduleType
    let scheduleValue: string

    if (cronExpr) {
      scheduleType = 'cron'
      scheduleValue = cronExpr
    } else if (every) {
      scheduleType = 'interval'
      scheduleValue = String(parseDurationToMinutes(every))
    } else {
      scheduleType = 'once'
      // Validate and normalize to ISO string
      const date = new Date(at!)
      if (isNaN(date.getTime())) throw new McpError(ErrorCode.InvalidParams, `Invalid timestamp: "${at}"`)
      scheduleValue = date.toISOString()
    }

    const contextMode: TaskContextMode = sessionMode === 'new' ? 'isolated' : 'session'

    const task = await taskService.createTask(this.agentId, {
      name,
      prompt: message,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      context_mode: contextMode
    })

    logger.info('Cron job created via tool', { agentId: this.agentId, taskId: task.id })
    return {
      content: [{ type: 'text' as const, text: `Job created:\n${JSON.stringify(task, null, 2)}` }]
    }
  }

  private async listJobs() {
    const { tasks } = await taskService.listTasks(this.agentId, { limit: 100 })

    if (tasks.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No scheduled jobs.' }] }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }]
    }
  }

  private async sendNotification(args: Record<string, string | undefined>) {
    const message = args.message
    if (!message) throw new McpError(ErrorCode.InvalidParams, "'message' is required for notify")

    const targetChannelId = args.channel_id
    let adapters = channelManager.getNotifyAdapters(this.agentId)

    if (targetChannelId) {
      adapters = adapters.filter((a) => a.channelId === targetChannelId)
    }

    if (adapters.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No notify-enabled channels found. Enable `is_notify_receiver` on at least one channel in agent settings.'
          }
        ]
      }
    }

    let sent = 0
    const errors: string[] = []

    for (const adapter of adapters) {
      for (const chatId of adapter.notifyChatIds) {
        try {
          await adapter.sendMessage(chatId, message)
          sent++
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          errors.push(`${adapter.channelId}/${chatId}: ${errMsg}`)
          logger.warn('Failed to send notification', {
            agentId: this.agentId,
            channelId: adapter.channelId,
            chatId,
            error: errMsg
          })
        }
      }
    }

    const parts = [`Notification sent to ${sent} chat(s).`]
    if (errors.length > 0) {
      parts.push(`Errors: ${errors.join('; ')}`)
    }

    logger.info('Notification sent via notify tool', { agentId: this.agentId, sent, errors: errors.length })
    return {
      content: [{ type: 'text' as const, text: parts.join(' ') }]
    }
  }

  private async removeJob(args: Record<string, string | undefined>) {
    const id = args.id
    if (!id) throw new McpError(ErrorCode.InvalidParams, "'id' is required for remove")

    const deleted = await taskService.deleteTask(this.agentId, id)
    if (!deleted) throw new McpError(ErrorCode.InvalidParams, `Job "${id}" not found`)

    logger.info('Cron job removed via tool', { agentId: this.agentId, taskId: id })
    return {
      content: [{ type: 'text' as const, text: `Job "${id}" removed.` }]
    }
  }
}

export default ClawServer

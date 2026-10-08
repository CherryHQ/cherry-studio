import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import { application } from '@application'
import { taskTimingQuerySchema } from '@shared/ai/taskTiming'

export class CherryTimingTools {
  constructor(private readonly sessionId: string) {}

  tools(): Tool[] {
    const inputSchema = z.toJSONSchema(taskTimingQuerySchema)
    delete inputSchema.$schema
    return [
      {
        name: 'task_timing',
        description:
          'Read original task timing records for this session. With no taskId, returns the latest ended task. Use list=true to list tasks; follow nextOffset for more records. Times are milliseconds. Unattributed native spans are counted at session scope; never assume the returned nodes cover every internal runtime step. Incomplete or unavailable records are not estimates. Never rerun tools, uploads or other actions to fill missing timing data.',
        inputSchema: inputSchema as Tool['inputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false }
      }
    ]
  }

  async call(args: unknown): Promise<CallToolResult> {
    const query = taskTimingQuerySchema.parse(args ?? {})
    const result = await application.get('TraceStorageService').getTaskTiming(this.sessionId, query)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
}

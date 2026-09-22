import * as z from 'zod'

export const taskTimingQuerySchema = z.object({
  taskId: z.string().min(1).optional(),
  list: z.boolean().optional(),
  sort: z.enum(['time', 'duration']).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100)
})

export type TaskTimingQuery = z.infer<typeof taskTimingQuerySchema>
export type TaskTimingStatus = 'running' | 'waiting' | 'success' | 'failed' | 'cancelled' | 'interrupted'

export interface TaskTimingNode {
  id: string
  taskId: string
  parentId: string | null
  name: string
  startTime: number
  endTime: number | null
  durationMs: number | null
  status: TaskTimingStatus
  completeness: 'complete' | 'incomplete'
}

export interface TaskTimingResult {
  tasks: TaskTimingNode[]
  nodes: TaskTimingNode[]
  nextOffset: number | null
  availability: 'available' | 'unavailable' | 'incomplete'
  unattributedSessionNodeCount?: number
}

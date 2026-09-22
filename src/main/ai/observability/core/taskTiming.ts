import { randomBytes } from 'node:crypto'

import type { TaskTimingNode, TaskTimingQuery, TaskTimingResult, TaskTimingStatus } from '@shared/ai/taskTiming'
import type { SpanEntity } from '@shared/data/types/trace'

const TIMING_ATTRIBUTES = new Set([
  'trace.topicId',
  'trace.modelName',
  'cs.agent_session_id',
  'cs.agent_turn_id',
  'cs.task_id',
  'cs.timing.kind',
  'cs.timing.status',
  'cs.timing.duration_ms',
  'cs.timing.execution_task_id',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.provider.name',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'tool.name',
  'tool_name',
  'tool_call_id'
])

/** Only metadata crosses the normal-mode storage boundary, including on subsequent updates. */
export function timingOnlySpan(span: SpanEntity): SpanEntity {
  return {
    id: span.id,
    traceId: span.traceId,
    parentId: span.parentId,
    name: span.name,
    kind: span.kind,
    status: span.status,
    isEnd: span.isEnd,
    startTime: span.startTime,
    endTime: span.endTime,
    durationMs: span.durationMs,
    topicId: span.topicId,
    modelName: span.modelName,
    attributes: Object.fromEntries(Object.entries(span.attributes ?? {}).filter(([key]) => TIMING_ATTRIBUTES.has(key))),
    events: undefined,
    links: undefined
  }
}

export function projectTaskTiming(spans: SpanEntity[], query: TaskTimingQuery, liveIds: Set<string>): TaskTimingResult {
  const byId = new Map(spans.map((span) => [span.id, span]))
  const taskFor = (span: SpanEntity): string | undefined => {
    const seen = new Set<string>()
    let current: SpanEntity | undefined = span
    while (current && !seen.has(current.id)) {
      const taskId = current.attributes?.['cs.task_id']
      if (typeof taskId === 'string' && taskId) return taskId
      seen.add(current.id)
      current = byId.get(current.parentId)
    }
    return undefined
  }
  const project = (span: SpanEntity): TaskTimingNode => {
    const explicit = span.attributes?.['cs.timing.status'] as TaskTimingStatus | undefined
    const status =
      !span.isEnd && !liveIds.has(span.id)
        ? 'interrupted'
        : (explicit ?? (!span.isEnd ? 'running' : span.status === 'ERROR' ? 'failed' : 'success'))
    const measured =
      span.isEnd &&
      span.endTime !== null &&
      Number.isFinite(span.endTime) &&
      typeof span.durationMs === 'number' &&
      Number.isFinite(span.durationMs) &&
      span.durationMs >= 0
    return {
      id: span.id,
      taskId: taskFor(span)!,
      parentId: span.parentId || null,
      name: span.name,
      startTime: span.startTime,
      endTime: span.isEnd ? span.endTime : null,
      durationMs: measured ? span.durationMs! : null,
      status,
      completeness: measured ? 'complete' : 'incomplete'
    }
  }
  const tasks = spans
    .filter((span) => span.attributes?.['cs.timing.kind'] === 'task')
    .map(project)
    .sort((a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id))
  const selected = query.taskId ?? tasks.find((task) => !['running', 'waiting'].includes(task.status))?.taskId
  const executionTask = spans.find(
    (span) => span.attributes?.['cs.timing.kind'] === 'task' && taskFor(span) === selected
  )?.attributes?.['cs.timing.execution_task_id']
  const nodes = query.list
    ? []
    : spans
        .filter(
          (span) =>
            selected !== undefined &&
            (taskFor(span) === selected ||
              (executionTask &&
                taskFor(span) === executionTask &&
                span.attributes?.['cs.timing.kind'] !== 'task' &&
                span.name !== 'agent.queue'))
        )
        .map(project)
        .sort(
          (a, b) =>
            (query.sort === 'duration' ? (b.durationMs ?? -1) - (a.durationMs ?? -1) : a.startTime - b.startTime) ||
            a.id.localeCompare(b.id)
        )
  const visibleTasks = query.list
    ? tasks.slice(query.offset, query.offset + query.limit)
    : tasks.filter((t) => t.taskId === selected)
  const page = nodes.slice(query.offset, query.offset + query.limit)
  const total = query.list ? tasks.length : nodes.length
  const unattributedSessionNodeCount = spans.filter(
    (span) => span.name.startsWith('claude_code.') && !taskFor(span)
  ).length
  return {
    ...(unattributedSessionNodeCount ? { unattributedSessionNodeCount } : {}),
    tasks: visibleTasks,
    nodes: page,
    nextOffset: query.offset + query.limit < total ? query.offset + query.limit : null,
    availability:
      total === 0
        ? 'unavailable'
        : unattributedSessionNodeCount > 0 || [...visibleTasks, ...nodes].some((n) => n.completeness === 'incomplete')
          ? 'incomplete'
          : 'available'
  }
}

type ActiveTiming = { span: SpanEntity; clock: number; waits: Map<string, { span: SpanEntity; clock: number }> }

export class TaskTimingRecorder {
  private readonly tasks = new Map<string, ActiveTiming>()
  private readonly nodes = new Map<string, { span: SpanEntity; clock: number }>()

  constructor(private readonly save: (span: SpanEntity) => void) {}

  begin(topicId: string, traceId: string, taskId: string): void {
    if (this.tasks.has(taskId)) return
    const span = this.span(topicId, traceId, taskId, 'agent.task', '', 'task')
    this.tasks.set(taskId, { span, clock: performance.now(), waits: new Map() })
    this.save(span)
    this.wait(taskId, 'queue', true)
  }

  linkTasks(taskIds: string[]): void {
    for (const taskId of taskIds.slice(1)) {
      const task = this.tasks.get(taskId)
      if (!task) continue
      task.span = { ...task.span, attributes: { ...task.span.attributes, 'cs.timing.execution_task_id': taskIds[0] } }
      this.save(task.span)
    }
  }

  beginNode(taskId: string, id: string, name: string, parentId?: string): void {
    const task = this.tasks.get(taskId)
    if (!task || this.nodes.has(id)) return
    const span = this.span(task.span.topicId!, task.span.traceId, taskId, name, parentId ?? task.span.id, 'node')
    this.nodes.set(id, { span, clock: performance.now() })
    this.save(span)
  }

  beginChild(parentKey: string, id: string, name: string): boolean {
    const parent = this.nodes.get(parentKey)
    if (!parent) return false
    if (this.nodes.has(id)) return true
    const span = this.span(
      parent.span.topicId!,
      parent.span.traceId,
      String(parent.span.attributes!['cs.task_id']),
      name,
      parent.span.id,
      'node'
    )
    this.nodes.set(id, { span, clock: performance.now() })
    this.save(span)
    return true
  }

  taskForNode(id: string): string | undefined {
    const taskId = this.nodes.get(id)?.span.attributes?.['cs.task_id']
    return typeof taskId === 'string' ? taskId : undefined
  }

  endNode(id: string, status: TaskTimingStatus): void {
    const node = this.nodes.get(id)
    if (!node) return
    this.end(node.span, node.clock, status)
    this.nodes.delete(id)
  }

  root(taskId: string): string | undefined {
    return this.tasks.get(taskId)?.span.id
  }

  wait(taskId: string, id: string, waiting: boolean): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    const existing = task.waits.get(id)
    if (waiting && !existing) {
      const span = this.span(
        task.span.topicId!,
        task.span.traceId,
        taskId,
        id === 'queue' ? 'agent.queue' : 'agent.approval',
        task.span.id,
        'wait'
      )
      task.waits.set(id, { span, clock: performance.now() })
      this.save(span)
    } else if (!waiting && existing) {
      this.end(existing.span, existing.clock, 'success')
      task.waits.delete(id)
    }
    task.span = {
      ...task.span,
      attributes: { ...task.span.attributes, 'cs.timing.status': task.waits.size ? 'waiting' : 'running' }
    }
    this.save(task.span)
  }

  finish(taskId: string, status: TaskTimingStatus): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    for (const [id, node] of this.nodes) {
      if (status !== 'success' && node.span.attributes?.['cs.task_id'] === taskId) this.endNode(id, status)
    }
    for (const wait of task.waits.values()) this.end(wait.span, wait.clock, status === 'success' ? 'success' : status)
    this.end(task.span, task.clock, status)
    this.tasks.delete(taskId)
  }

  finishSession(topicId: string): void {
    for (const [id, task] of this.tasks) if (task.span.topicId === topicId) this.finish(id, 'cancelled')
    for (const [id, node] of this.nodes) if (node.span.topicId === topicId) this.endNode(id, 'interrupted')
  }

  private span(
    topicId: string,
    traceId: string,
    taskId: string,
    name: string,
    parentId: string,
    kind: string
  ): SpanEntity {
    return {
      id: randomBytes(8).toString('hex'),
      topicId,
      traceId,
      parentId,
      name,
      kind: 'INTERNAL',
      startTime: Date.now(),
      endTime: null,
      status: 'UNSET',
      isEnd: false,
      attributes: {
        'cs.task_id': taskId,
        'cs.timing.kind': kind,
        'cs.timing.status': kind === 'wait' ? 'waiting' : 'running'
      },
      events: undefined,
      links: undefined
    }
  }

  private end(span: SpanEntity, clock: number, status: TaskTimingStatus): void {
    this.save({
      ...span,
      endTime: status === 'interrupted' ? null : Date.now(),
      durationMs: status === 'interrupted' ? undefined : Math.max(0, performance.now() - clock),
      isEnd: true,
      status: status === 'success' ? 'OK' : 'ERROR',
      attributes: { ...span.attributes, 'cs.timing.status': status }
    })
  }
}

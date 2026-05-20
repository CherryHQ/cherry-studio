import { loggerService } from '@logger'
import type { FileMetadata } from '@types'
import type { TextStreamPart } from 'ai'

import { broadcastSessionChanged } from './channels/sessionStreamIpc'
import {
  type CollaborationRoomAutonomyConfig,
  type CollaborationRoomRecord,
  collaborationService
} from './CollaborationService'
import { sessionMessageService } from './SessionMessageService'
import { sessionService } from './SessionService'
import { type WorkerRuntimeFamily, type WorkerRuntimeInstance, workerRuntimeService } from './WorkerRuntimeService'

const logger = loggerService.withContext('CollaborationRuntimeService')
const AUTONOMY_POLL_INTERVAL_MS = 60_000
const ROUTER_MODEL_INSTRUCTIONS = [
  '你现在是当前讨论组的主控队长，只负责判断该怎么推进，不要执行任务本身。',
  '你必须只输出一个 JSON 对象，不要输出 Markdown，不要加解释。',
  '可用 action:',
  '- assign: 给当前房间任务选择一个 targetAgentId',
  '- create_task: 在当前工作区新建一个任务房间，提供 title、content，可选 targetAgentId',
  '- no_op: 当前不应该动，只写 reason'
].join('\n')

type RouterDecision =
  | { action: 'assign'; targetAgentId: string; reason: string }
  | { action: 'create_task'; title: string; content: string; reason: string; targetAgentId?: string }
  | { action: 'no_op'; reason: string }

type RoomAutonomyState = {
  enabled: boolean
  paused: boolean
  idleMinutes: number
  routerAgentId?: string
  status: 'disabled' | 'paused' | 'waiting' | 'running' | 'ready'
  idleSince?: string
  nextRunAt?: string
  remainingMs?: number
  activeRunId?: string
  lastResult?: CollaborationRoomAutonomyConfig['lastResult']
}

type ExecuteTaskOptions = {
  source: 'user-task' | 'autonomy'
  autonomySource?: 'manual' | 'idle'
  routeReason?: string
  eventMessage?: string
}

type AssignAndRunInput = {
  targetAgentId: string
  content?: string
  attachments?: FileMetadata[]
  reasoningEffort?: string
  permissionMode?: string
  toolsEnabled?: boolean
}

type AssignAndRunResult = {
  roomId: string
  taskMessageId: string
  targetAgentId: string
  effectiveTargetAgentId?: string
  status: 'started' | 'deferred'
  eventMessage: string
}

type ExplicitTargetResolution =
  | {
      mode: 'execute'
      requestedTarget: WorkerRuntimeInstance
      effectiveTarget: WorkerRuntimeInstance
      eventMessage: string
      routeReason: string
    }
  | {
      mode: 'deferred'
      requestedTargetId: string
      requestedTarget?: WorkerRuntimeInstance
      eventMessage: string
    }

type ActiveAutonomyRun = {
  runId: string
  abortController: AbortController
}

type ActiveTaskRun = {
  runId: string
  roomId: string
  workerAgentId: string
  abortController: AbortController
}

type StreamTextSnapshot = {
  text: string
  hasStderr: boolean
}

type TaskMessageMetadata = {
  attachments?: FileMetadata[]
  reasoningEffort?: string
  permissionMode?: string
  toolsEnabled?: boolean
}

const isFileAttachment = (value: unknown): value is FileMetadata => {
  return Boolean(value && typeof value === 'object' && 'path' in value && 'origin_name' in value && 'type' in value)
}

const getRouterLabel = (router?: WorkerRuntimeInstance | null) => router?.label || '主控队长'

export class CollaborationRuntimeService {
  private static instance: CollaborationRuntimeService | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private readonly activeAutonomyRuns = new Map<string, ActiveAutonomyRun>()
  private readonly activeTaskRuns = new Map<string, ActiveTaskRun>()

  static getInstance(): CollaborationRuntimeService {
    if (!CollaborationRuntimeService.instance) {
      CollaborationRuntimeService.instance = new CollaborationRuntimeService()
    }
    return CollaborationRuntimeService.instance
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedulePoll(5_000)
  }

  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    for (const [roomId, active] of this.activeAutonomyRuns) {
      active.abortController.abort('Autonomy stopped')
      this.activeAutonomyRuns.delete(roomId)
    }
    for (const [runId, active] of this.activeTaskRuns) {
      active.abortController.abort('Runtime stopped')
      this.activeTaskRuns.delete(runId)
    }
  }

  async assignRoomAndRun(roomId: string, input: AssignAndRunInput): Promise<AssignAndRunResult> {
    const room = await collaborationService.getRoom(roomId)
    if (!room) {
      throw new Error(`Room not found: ${roomId}`)
    }

    const [requestedTarget, families] = await Promise.all([
      workerRuntimeService.getInstance(input.targetAgentId),
      workerRuntimeService.listWorkers()
    ])

    const latestTaskMessage = input.content?.trim() ? null : await this.getLatestUserTaskMessage(roomId)
    const taskContent = input.content?.trim() || latestTaskMessage?.content?.trim()
    if (!taskContent) {
      throw new Error('当前房间没有可重跑的任务内容。')
    }

    const taskMessage = await collaborationService.createRoomMessage({
      roomId,
      authorType: 'user',
      kind: 'task',
      intent: 'task',
      routing: 'none',
      content: taskContent,
      metadata: this.buildTaskMessageMetadata(latestTaskMessage?.metadata, {
        targetAgentId: input.targetAgentId,
        attachments: input.attachments,
        reasoningEffort: input.reasoningEffort,
        permissionMode: input.permissionMode,
        toolsEnabled: input.toolsEnabled
      })
    })

    const resolution = await this.resolveExplicitTarget(input.targetAgentId, requestedTarget, families)

    if (resolution.mode === 'deferred') {
      await collaborationService.addRoomMember({
        roomId,
        memberType: 'agent',
        memberId: input.targetAgentId,
        displayName: resolution.requestedTarget?.label
      })
      await collaborationService.updateRoom(roomId, {
        assignedAgentId: input.targetAgentId,
        status: 'todo'
      })
      await collaborationService.createRoomMessage({
        roomId,
        authorType: 'system',
        kind: 'event',
        content: resolution.eventMessage
      })
      return {
        roomId,
        taskMessageId: taskMessage.id,
        targetAgentId: input.targetAgentId,
        status: 'deferred',
        eventMessage: resolution.eventMessage
      }
    }

    void this.executeRoomTask(room, taskMessage, resolution.effectiveTarget, {
      source: 'user-task',
      routeReason: resolution.routeReason,
      eventMessage: resolution.eventMessage
    }).catch((error) => {
      logger.warn('Failed to execute explicitly assigned room task', {
        roomId,
        messageId: taskMessage.id,
        targetAgentId: input.targetAgentId,
        effectiveTargetAgentId: resolution.effectiveTarget.agent.id,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    return {
      roomId,
      taskMessageId: taskMessage.id,
      targetAgentId: input.targetAgentId,
      effectiveTargetAgentId: resolution.effectiveTarget.agent.id,
      status: 'started',
      eventMessage: resolution.eventMessage
    }
  }

  async handleTaskMessage(roomId: string, messageId: string): Promise<void> {
    const [room, message, families] = await Promise.all([
      collaborationService.getRoom(roomId),
      collaborationService.getRoomMessage(messageId),
      workerRuntimeService.listWorkers()
    ])
    if (!room || !message || message.authorType !== 'user' || message.intent !== 'task') return

    const explicitTargetAgentId = this.readTargetAgentId(message.metadata ?? undefined)
    const autonomySource = this.readAutonomySource(message.metadata ?? undefined)

    if (explicitTargetAgentId) {
      const explicitTarget = await workerRuntimeService.getInstance(explicitTargetAgentId)
      const resolution = await this.resolveExplicitTarget(explicitTargetAgentId, explicitTarget, families)
      if (resolution.mode === 'deferred') {
        await collaborationService.createRoomMessage({
          roomId: room.id,
          authorType: 'system',
          kind: 'event',
          content: resolution.eventMessage
        })
        await collaborationService.updateRoom(room.id, {
          assignedAgentId: explicitTargetAgentId,
          status: 'todo'
        })
        return
      }
      await this.executeRoomTask(room, message, resolution.effectiveTarget, {
        source: autonomySource ? 'autonomy' : 'user-task',
        autonomySource,
        routeReason: resolution.routeReason,
        eventMessage: resolution.eventMessage
      })
      return
    }

    if (room.assignedAgentId) {
      const assignedTarget = await workerRuntimeService.getInstance(room.assignedAgentId)
      if (assignedTarget?.canRun && assignedTarget.workload.activeRuns === 0) {
        await this.executeRoomTask(room, message, assignedTarget, {
          source: autonomySource ? 'autonomy' : 'user-task',
          autonomySource,
          routeReason: `任务已按当前负责人 ${assignedTarget.label} 执行`,
          eventMessage: `任务已按当前负责人 ${assignedTarget.label} 执行`
        })
        return
      }
    }

    const router = await this.resolveRouterInstance(room, families)
    if (!router) {
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: '当前没有可用的主控队长，任务保持在待整理。'
      })
      return
    }

    const decision = await this.routeCurrentTask(
      room,
      { id: message.id, content: message.content, metadata: message.metadata ?? undefined },
      router,
      families
    )
    await this.applyRouterDecision(room, decision, message, router)
  }

  async getRoomAutonomyState(roomId: string): Promise<RoomAutonomyState> {
    const room = await collaborationService.getRoom(roomId)
    if (!room) {
      throw new Error(`Room not found: ${roomId}`)
    }
    return this.computeRoomAutonomyState(room)
  }

  async updateRoomAutonomy(
    roomId: string,
    patch: Partial<Pick<CollaborationRoomAutonomyConfig, 'enabled' | 'idleMinutes' | 'paused' | 'routerAgentId'>>
  ): Promise<RoomAutonomyState> {
    const room = await collaborationService.updateRoomAutonomy(roomId, patch)
    if (!room) throw new Error(`Room not found: ${roomId}`)
    return this.computeRoomAutonomyState(room)
  }

  async runAutonomyNow(roomId: string): Promise<RoomAutonomyState> {
    void this.runAutonomy(roomId, 'manual')
    return this.getRoomAutonomyState(roomId)
  }

  async stopRoomAutonomy(roomId: string): Promise<RoomAutonomyState> {
    const active = this.activeAutonomyRuns.get(roomId)
    if (active) {
      active.abortController.abort('Stopped by user')
      this.activeAutonomyRuns.delete(roomId)
    }
    await collaborationService.updateRoomAutonomy(roomId, { paused: true })
    return this.getRoomAutonomyState(roomId)
  }

  async stopRoomRun(runId: string): Promise<boolean> {
    const run = await collaborationService.getRoomRun(runId)
    if (!run) return false
    const active = this.activeTaskRuns.get(runId)
    if (active) {
      active.abortController.abort('Stopped by user')
    }
    await collaborationService.updateRoomRun(runId, {
      status: 'cancelled',
      summary: run.summary ?? '任务已强行停止',
      error: run.error ?? 'Stopped by user'
    })
    await collaborationService.updateRoom(run.roomId, { status: 'blocked' })
    await collaborationService.createRoomMessage({
      roomId: run.roomId,
      authorType: 'system',
      kind: 'event',
      content: '任务已强行停止。'
    })
    return true
  }

  private schedulePoll(delayMs = AUTONOMY_POLL_INTERVAL_MS) {
    if (!this.running) return
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      void this.poll()
    }, delayMs)
  }

  private async poll(): Promise<void> {
    try {
      const rooms = await collaborationService.listAllRooms()
      for (const room of rooms) {
        const autonomy = room.autonomy
        if (!autonomy.enabled || autonomy.paused) continue
        const state = await this.computeRoomAutonomyState(room)
        if (state.status === 'ready') {
          await this.runAutonomy(room.id, 'idle')
        }
      }
    } catch (error) {
      logger.error('Failed to poll room autonomy', error as Error)
    } finally {
      this.schedulePoll()
    }
  }

  private async runAutonomy(roomId: string, source: 'manual' | 'idle'): Promise<void> {
    const room = await collaborationService.getRoom(roomId)
    if (!room) throw new Error(`Room not found: ${roomId}`)

    if (source === 'idle') {
      const state = await this.computeRoomAutonomyState(room)
      if (state.status !== 'ready') return
      if (room.autonomy.lastTriggeredAt && state.idleSince && room.autonomy.lastTriggeredAt >= state.idleSince) {
        return
      }
    }

    const families = await workerRuntimeService.listWorkers()
    const router = await this.resolveRouterInstance(room, families)
    if (!router) {
      await collaborationService.createRoomMessage({
        roomId,
        authorType: 'system',
        kind: 'event',
        content: '当前没有可用的主控队长，自主行动已跳过。'
      })
      await collaborationService.updateRoomAutonomy(roomId, {
        lastTriggeredAt: new Date().toISOString(),
        lastResult: {
          status: 'no_op',
          summary: '没有可用的主控队长',
          source,
          at: new Date().toISOString()
        }
      })
      return
    }

    const abortController = new AbortController()
    this.activeAutonomyRuns.set(roomId, { runId: 'pending', abortController })

    try {
      const decision = await this.routeAutonomy(room, router, families, abortController)
      await this.applyAutonomyDecision(room, decision, router, source)
    } finally {
      const active = this.activeAutonomyRuns.get(roomId)
      if (active?.runId === 'pending') {
        this.activeAutonomyRuns.delete(roomId)
      }
    }
  }

  private async applyAutonomyDecision(
    room: CollaborationRoomRecord,
    decision: RouterDecision,
    router: WorkerRuntimeInstance,
    source: 'manual' | 'idle'
  ) {
    if (decision.action === 'no_op') {
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `自主行动未执行：${decision.reason}`
      })
      await collaborationService.updateRoomAutonomy(room.id, {
        paused: false,
        lastTriggeredAt: new Date().toISOString(),
        lastResult: {
          status: 'no_op',
          summary: decision.reason,
          source,
          at: new Date().toISOString()
        }
      })
      return
    }

    if (decision.action === 'create_task') {
      if (await this.hasPendingSimilarTask(room.workspaceId, decision.title, decision.content)) {
        await collaborationService.createRoomMessage({
          roomId: room.id,
          authorType: 'system',
          kind: 'event',
          content: `自主行动跳过了重复任务：${decision.title}`
        })
        await collaborationService.updateRoomAutonomy(room.id, {
          paused: false,
          lastTriggeredAt: new Date().toISOString(),
          lastResult: {
            status: 'no_op',
            summary: `重复任务已跳过：${decision.title}`,
            source,
            at: new Date().toISOString()
          }
        })
        return
      }

      const createdRoom = await collaborationService.createRoom({
        workspaceId: room.workspaceId,
        title: decision.title,
        status: 'todo',
        assignedAgentId: decision.targetAgentId,
        metadata: {
          source: 'autonomy',
          createdByRouterAgentId: router.agent.id,
          seedContent: decision.content
        }
      })
      await collaborationService.createRoomMessage({
        roomId: createdRoom.id,
        authorType: 'system',
        kind: 'event',
        content: `主控队长自主创建了任务：${decision.title}`
      })
      const createdMessage = await collaborationService.createRoomMessage({
        roomId: createdRoom.id,
        authorType: 'user',
        kind: 'task',
        intent: 'task',
        content: decision.content,
        metadata: {
          source: 'autonomy',
          targetAgentId: decision.targetAgentId,
          routeReason: decision.reason
        }
      })
      void this.handleTaskMessage(createdRoom.id, createdMessage.id).catch((error) => {
        logger.warn('Failed to process autonomy-created task', {
          roomId: createdRoom.id,
          messageId: createdMessage.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `自主行动创建了新任务：${decision.title}`
      })
      await collaborationService.updateRoomAutonomy(room.id, {
        paused: false,
        lastTriggeredAt: new Date().toISOString(),
        lastResult: {
          status: 'completed',
          summary: `已创建任务：${decision.title}`,
          source,
          at: new Date().toISOString()
        }
      })
      return
    }

    const target = await workerRuntimeService.getInstance(decision.targetAgentId)
    if (!target?.canRun) {
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `自主行动选择的实例当前不可用：${decision.targetAgentId}`
      })
      await collaborationService.updateRoomAutonomy(room.id, {
        paused: false,
        lastTriggeredAt: new Date().toISOString(),
        lastResult: {
          status: 'failed',
          summary: `实例不可用：${decision.targetAgentId}`,
          source,
          at: new Date().toISOString()
        }
      })
      return
    }

    const taskMessage = await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'user',
      kind: 'task',
      intent: 'task',
      content: decision.reason,
      metadata: {
        source: 'autonomy',
        autonomySource: source,
        targetAgentId: decision.targetAgentId,
        routeReason: decision.reason
      }
    })
    await collaborationService.updateRoomAutonomy(room.id, {
      paused: false,
      lastTriggeredAt: new Date().toISOString(),
      lastResult: {
        status: 'running',
        summary: `已分派给 ${decision.targetAgentId}`,
        source,
        at: new Date().toISOString()
      }
    })
    await this.executeRoomTask(room, taskMessage, target, {
      source: 'autonomy',
      autonomySource: source,
      routeReason: decision.reason,
      eventMessage: `任务已指派给 ${target.label}`
    })
  }

  private async routeAutonomy(
    room: CollaborationRoomRecord,
    router: WorkerRuntimeInstance,
    families: WorkerRuntimeFamily[],
    abortController: AbortController
  ): Promise<RouterDecision> {
    const [members, messages, runs] = await Promise.all([
      collaborationService.listRoomMembers(room.id),
      collaborationService.listRoomMessages(room.id),
      collaborationService.listRoomRuns(room.id)
    ])
    const candidates = await this.getHealthyRoomInstances(room, members, families, { includeRouter: true })

    const prompt = [
      ROUTER_MODEL_INSTRUCTIONS,
      '',
      '当前模式：空闲 30 分钟后的自主行动。',
      `房间标题：${room.title}`,
      `房间状态：${room.status}`,
      `工作区：${room.workspaceId}`,
      '',
      '候选实例：',
      ...candidates.map(
        (candidate) => `- ${candidate.agent.id} | ${candidate.label} | ${candidate.family} | ${candidate.role}`
      ),
      '',
      '最近消息：',
      ...messages.slice(-12).map((message) => `- [${message.authorType}] ${message.content}`),
      '',
      '最近运行：',
      ...runs
        .slice(0, 6)
        .map((run) => `- ${run.workerAgentId} | ${run.status} | ${run.summary ?? run.result ?? run.error ?? ''}`),
      '',
      '如果当前不应该动，请返回 {"action":"no_op","reason":"..."}。',
      '如果要创建新任务，请返回 {"action":"create_task","title":"...","content":"...","targetAgentId":"...","reason":"..."}。',
      '如果只需要推进当前房间，请返回 {"action":"assign","targetAgentId":"...","reason":"..."}。'
    ].join('\n')

    return this.invokeRouterDecision(router, prompt, abortController, {
      fallback: () => ({ action: 'no_op', reason: '路由决策失败，已跳过本轮自主行动。' })
    })
  }

  private async routeCurrentTask(
    room: CollaborationRoomRecord,
    message: { id: string; content: string; metadata?: Record<string, unknown> },
    router: WorkerRuntimeInstance,
    families: WorkerRuntimeFamily[]
  ): Promise<RouterDecision> {
    const routerLabel = getRouterLabel(router)
    const members = await collaborationService.listRoomMembers(room.id)
    const candidates = await this.getHealthyRoomInstances(room, members, families, { includeRouter: true })
    const fallbackTarget = candidates.find((candidate) => candidate.workload.activeRuns === 0)

    const prompt = [
      ROUTER_MODEL_INSTRUCTIONS,
      '',
      '当前模式：用户刚在讨论组里发布了一个任务，请从当前成员里选择一个实例来执行。',
      `房间标题：${room.title}`,
      `任务内容：${message.content}`,
      '',
      '候选实例：',
      ...candidates.map(
        (candidate) =>
          `- ${candidate.agent.id} | ${candidate.label} | ${candidate.family} | ${candidate.role} | ${candidate.workload.label}`
      ),
      '',
      '只允许返回 assign 或 no_op。'
    ].join('\n')

    return this.invokeRouterDecision(router, prompt, new AbortController(), {
      fallback: () =>
        fallbackTarget
          ? {
              action: 'assign',
              targetAgentId: fallbackTarget.agent.id,
              reason: `${routerLabel} 已回退到 ${fallbackTarget.label}`
            }
          : {
              action: 'no_op',
              reason: '当前讨论组没有空闲实例。'
            }
    })
  }

  private async invokeRouterDecision(
    router: WorkerRuntimeInstance,
    prompt: string,
    abortController: AbortController,
    options: { fallback: () => RouterDecision }
  ): Promise<RouterDecision> {
    try {
      let session = await this.getLatestSession(router.agent.id)
      if (!session) {
        const created = await sessionService.createSession(router.agent.id, {})
        if (!created) {
          return options.fallback()
        }
        const createdSession = await sessionService.getSession(router.agent.id, created.id)
        if (!createdSession) {
          return options.fallback()
        }
        session = createdSession
      }
      if (!session) {
        return options.fallback()
      }

      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        { content: prompt },
        abortController,
        { persist: true }
      )
      const { text } = await this.collectResponse(stream)
      await completion
      const parsed = this.parseRouterDecision(text)
      return parsed ?? options.fallback()
    } catch (error) {
      logger.warn('Failed to invoke router decision', {
        agentId: router.agent.id,
        error: error instanceof Error ? error.message : String(error)
      })
      return options.fallback()
    }
  }

  private parseRouterDecision(text: string): RouterDecision | null {
    const jsonText = this.extractJsonObject(text)
    if (!jsonText) return null

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>
      if (parsed.action === 'assign' && typeof parsed.targetAgentId === 'string') {
        return {
          action: 'assign',
          targetAgentId: parsed.targetAgentId,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '主控队长已完成分派'
        }
      }
      if (parsed.action === 'create_task' && typeof parsed.title === 'string' && typeof parsed.content === 'string') {
        return {
          action: 'create_task',
          title: parsed.title,
          content: parsed.content,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '主控队长创建了一个新任务',
          targetAgentId: typeof parsed.targetAgentId === 'string' ? parsed.targetAgentId : undefined
        }
      }
      if (parsed.action === 'no_op') {
        return {
          action: 'no_op',
          reason: typeof parsed.reason === 'string' ? parsed.reason : '当前不需要新的动作'
        }
      }
      return null
    } catch {
      return null
    }
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    return text.slice(start, end + 1)
  }

  private async applyRouterDecision(
    room: CollaborationRoomRecord,
    decision: RouterDecision,
    message: { id: string; content: string },
    router: WorkerRuntimeInstance
  ) {
    const routerLabel = getRouterLabel(router)

    if (decision.action === 'no_op') {
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `${routerLabel} 未分派任务：${decision.reason}`
      })
      return
    }

    if (decision.action === 'create_task') {
      if (await this.hasPendingSimilarTask(room.workspaceId, decision.title, decision.content)) {
        await collaborationService.createRoomMessage({
          roomId: room.id,
          authorType: 'system',
          kind: 'event',
          content: `${routerLabel} 跳过了重复任务：${decision.title}`
        })
        return
      }

      const createdRoom = await collaborationService.createRoom({
        workspaceId: room.workspaceId,
        title: decision.title,
        status: 'todo',
        assignedAgentId: decision.targetAgentId,
        metadata: {
          source: 'router',
          createdByRouterAgentId: router.agent.id,
          seedContent: decision.content
        }
      })
      const createdMessage = await collaborationService.createRoomMessage({
        roomId: createdRoom.id,
        authorType: 'user',
        kind: 'task',
        intent: 'task',
        content: decision.content,
        metadata: {
          source: 'router',
          targetAgentId: decision.targetAgentId,
          routeReason: decision.reason
        }
      })
      void this.handleTaskMessage(createdRoom.id, createdMessage.id).catch((error) => {
        logger.warn('Failed to process router-created task', {
          roomId: createdRoom.id,
          messageId: createdMessage.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `${routerLabel} 创建了新任务：${decision.title}`
      })
      return
    }

    const target = await workerRuntimeService.getInstance(decision.targetAgentId)
    if (!target?.canRun) {
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `${routerLabel} 选择的实例当前不可用：${decision.targetAgentId}`
      })
      return
    }

    await this.executeRoomTask(room, message, target, {
      source: 'user-task',
      routeReason: decision.reason,
      eventMessage: `${routerLabel} 将任务分配给 ${target.label}：${decision.reason}`
    })
  }

  private async executeRoomTask(
    room: CollaborationRoomRecord,
    message: { id: string; content: string; metadata?: Record<string, unknown> | null },
    target: WorkerRuntimeInstance,
    options: ExecuteTaskOptions
  ): Promise<void> {
    if (!target.canRun) {
      throw new Error(`${target.label} 当前不可运行`)
    }
    if (target.workload.activeRuns > 0) {
      await collaborationService.createRoomMessage({
        roomId: room.id,
        authorType: 'system',
        kind: 'event',
        content: `${target.label} 当前忙碌，任务保持在待整理。`
      })
      await collaborationService.updateRoom(room.id, {
        status: 'todo',
        assignedAgentId: target.agent.id
      })
      return
    }

    await collaborationService.addRoomMember({
      roomId: room.id,
      memberType: 'agent',
      memberId: target.agent.id,
      displayName: target.label
    })
    await collaborationService.updateRoom(room.id, {
      assignedAgentId: target.agent.id,
      status: 'in_progress'
    })
    await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'system',
      kind: 'event',
      content:
        options.eventMessage ??
        (options.routeReason
          ? `主控队长将任务分配给 ${target.label}：${options.routeReason}`
          : `任务已指派给 ${target.label}`)
    })

    const session = await this.getOrCreateRoomSession(room.id, target)
    const run = await collaborationService.createRoomRun({
      roomId: room.id,
      workerAgentId: target.agent.id,
      triggerMessageId: message.id,
      sessionId: session.id,
      status: 'running',
      commandSnapshot: target.command,
      summary: options.routeReason
    })

    const streamMessage = await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'agent',
      authorId: target.agent.id,
      kind: 'message',
      content: ''
    })
    let streamText = ''
    let streamHasStderr = false
    const buildStreamMetadata = () =>
      streamHasStderr
        ? ({
            ...(streamMessage.metadata ?? {}),
            stream: {
              hasStderr: true,
              workerFamily: target.family
            }
          } as Record<string, unknown>)
        : undefined

    let lastStreamFlushAt = 0
    const persistStreamText = async (snapshot: StreamTextSnapshot, force = false) => {
      const text = snapshot.text
      if (!text.trim()) return
      const shouldUpdateMetadata = snapshot.hasStderr && !streamHasStderr
      const now = Date.now()
      if (!force && now - lastStreamFlushAt < 250 && !shouldUpdateMetadata) return
      lastStreamFlushAt = now
      if (text === streamText && !shouldUpdateMetadata) return
      streamText = text
      streamHasStderr = streamHasStderr || snapshot.hasStderr
      await collaborationService.updateRoomMessage(streamMessage.id, {
        content: text,
        metadata: buildStreamMetadata()
      })
    }

    const abortController = new AbortController()
    this.activeTaskRuns.set(run.id, {
      runId: run.id,
      roomId: room.id,
      workerAgentId: target.agent.id,
      abortController
    })

    if (options.source === 'autonomy') {
      this.activeAutonomyRuns.set(room.id, {
        runId: run.id,
        abortController
      })
    }

    try {
      const prompt = await this.buildExecutionPrompt(
        room.id,
        target,
        message.content,
        message.metadata as TaskMessageMetadata | undefined
      )
      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        { content: prompt },
        abortController,
        {
          persist: true,
          displayContent: message.content,
          streamBridge: {
            sessionId: session.id,
            agentId: target.agent.id,
            userMessage: {
              text: message.content
            }
          }
        }
      )
      const streamResult = await this.collectResponse(stream, persistStreamText)
      const text = streamResult.text
      await persistStreamText(streamResult, true)
      await completion
      if (abortController.signal.aborted) {
        throw new Error('Stopped by user')
      }

      await collaborationService.updateRoomRun(run.id, {
        status: 'completed',
        result: text.slice(0, 6000),
        summary: text.slice(0, 240) || options.routeReason
      })
      await collaborationService.updateRoomMessage(streamMessage.id, {
        content: text || `${target.label} 已完成任务。`,
        metadata: buildStreamMetadata()
      })
      await collaborationService.updateRoom(room.id, {
        assignedAgentId: target.agent.id,
        status: 'needs_confirmation'
      })
      broadcastSessionChanged(target.agent.id, session.id, true)

      if (options.source === 'autonomy') {
        await collaborationService.updateRoomAutonomy(room.id, {
          paused: false,
          lastTriggeredAt: new Date().toISOString(),
          lastResult: {
            status: 'completed',
            summary: text.slice(0, 180) || `${target.label} 已完成任务`,
            source: options.autonomySource ?? 'manual',
            at: new Date().toISOString(),
            runId: run.id
          }
        })
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      const aborted = abortController.signal.aborted
      if (aborted) {
        await collaborationService.updateRoomRun(run.id, {
          status: 'cancelled',
          error: messageText,
          summary: '任务已停止'
        })
        await collaborationService.updateRoomMessage(streamMessage.id, {
          content: streamText || `${target.label} 的任务已停止。`,
          metadata: buildStreamMetadata()
        })
        await collaborationService.updateRoom(room.id, {
          assignedAgentId: target.agent.id,
          status: 'blocked'
        })
      } else {
        await collaborationService.updateRoomRun(run.id, {
          status: 'failed',
          error: messageText,
          summary: options.routeReason
        })
        await collaborationService.updateRoomMessage(streamMessage.id, {
          content: streamText || `${target.label} 执行失败：${messageText}`,
          metadata: buildStreamMetadata()
        })
        await collaborationService.createRoomMessage({
          roomId: room.id,
          authorType: 'system',
          kind: 'event',
          content: `${target.label} 执行失败：${messageText}`
        })
        await collaborationService.updateRoom(room.id, {
          assignedAgentId: target.agent.id,
          status: 'blocked'
        })
      }
      if (options.source === 'autonomy') {
        await collaborationService.updateRoomAutonomy(room.id, {
          paused: false,
          lastTriggeredAt: new Date().toISOString(),
          lastResult: {
            status: aborted ? 'cancelled' : 'failed',
            summary: aborted ? '任务已停止' : messageText,
            source: options.autonomySource ?? 'manual',
            at: new Date().toISOString(),
            runId: run.id
          }
        })
      }
      broadcastSessionChanged(target.agent.id, session.id, true)
    } finally {
      this.activeTaskRuns.delete(run.id)
      if (options.source === 'autonomy') {
        this.activeAutonomyRuns.delete(room.id)
      }
    }
  }

  private async resolveExplicitTarget(
    targetAgentId: string,
    requestedTarget: WorkerRuntimeInstance | null,
    families: WorkerRuntimeFamily[]
  ): Promise<ExplicitTargetResolution> {
    if (!requestedTarget?.canRun) {
      return {
        mode: 'deferred',
        requestedTargetId: targetAgentId,
        requestedTarget: requestedTarget ?? undefined,
        eventMessage: '指定实例当前不可用，任务已保留在待办。'
      }
    }

    if (requestedTarget.workload.activeRuns === 0) {
      return {
        mode: 'execute',
        requestedTarget,
        effectiveTarget: requestedTarget,
        eventMessage: `任务已指派给 ${requestedTarget.label}`,
        routeReason: `任务已直接交给 ${requestedTarget.label}`
      }
    }

    const fallbackTarget = this.findSameFamilyIdleInstance(requestedTarget, families)
    if (!fallbackTarget) {
      return {
        mode: 'deferred',
        requestedTargetId: targetAgentId,
        requestedTarget,
        eventMessage: `${requestedTarget.label} 正在工作，任务已保留待办，等待同家族空闲分身。`
      }
    }

    return {
      mode: 'execute',
      requestedTarget,
      effectiveTarget: fallbackTarget,
      eventMessage: `${requestedTarget.label} 忙碌，任务已转交给 ${fallbackTarget.label}`,
      routeReason: `${requestedTarget.label} 忙碌，已转交给 ${fallbackTarget.label}`
    }
  }

  private findSameFamilyIdleInstance(
    requestedTarget: WorkerRuntimeInstance,
    families: WorkerRuntimeFamily[]
  ): WorkerRuntimeInstance | undefined {
    const family = families.find((item) => item.key === requestedTarget.family)
    return family?.instances.find(
      (instance) =>
        instance.agent.id !== requestedTarget.agent.id && instance.canRun && instance.workload.activeRuns === 0
    )
  }

  private async getLatestUserTaskMessage(roomId: string) {
    const messages = await collaborationService.listRoomMessages(roomId)
    return [...messages].reverse().find((message) => message.authorType === 'user' && message.intent === 'task')
  }

  private buildTaskMessageMetadata(
    sourceMetadata: Record<string, unknown> | null | undefined,
    overrides: {
      targetAgentId: string
      attachments?: FileMetadata[]
      reasoningEffort?: string
      permissionMode?: string
      toolsEnabled?: boolean
    }
  ): Record<string, unknown> {
    const base =
      sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata)
        ? { ...sourceMetadata }
        : {}
    base.targetAgentId = overrides.targetAgentId

    if (overrides.attachments !== undefined) {
      base.attachments = overrides.attachments
    }
    if (overrides.reasoningEffort !== undefined) {
      base.reasoningEffort = overrides.reasoningEffort
    }
    if (overrides.permissionMode !== undefined) {
      base.permissionMode = overrides.permissionMode
    }
    if (overrides.toolsEnabled !== undefined) {
      base.toolsEnabled = overrides.toolsEnabled
    }

    return base
  }

  private async computeRoomAutonomyState(room: CollaborationRoomRecord): Promise<RoomAutonomyState> {
    const autonomy = room.autonomy
    const active = this.activeAutonomyRuns.get(room.id)
    if (!autonomy.enabled) {
      return {
        enabled: false,
        paused: autonomy.paused,
        idleMinutes: autonomy.idleMinutes,
        routerAgentId: autonomy.routerAgentId,
        status: 'disabled',
        lastResult: autonomy.lastResult
      }
    }

    if (autonomy.paused) {
      return {
        enabled: true,
        paused: true,
        idleMinutes: autonomy.idleMinutes,
        routerAgentId: autonomy.routerAgentId,
        status: 'paused',
        lastResult: autonomy.lastResult
      }
    }

    const [members, runs] = await Promise.all([
      collaborationService.listRoomMembers(room.id),
      collaborationService.listRoomRuns(room.id)
    ])
    const latestRunActivity = runs[0]?.updatedAt
    const latestMemberActivity = members.reduce<string | undefined>((latest, member) => {
      if (!latest || member.updatedAt > latest) return member.updatedAt
      return latest
    }, undefined)

    const idleSince = [room.lastActivityAt, latestRunActivity, latestMemberActivity].filter(Boolean).sort().at(-1)
    const activeRuns = runs.filter((run) => run.status === 'queued' || run.status === 'running')
    const nextRunAt = idleSince
      ? new Date(new Date(idleSince).getTime() + autonomy.idleMinutes * 60_000).toISOString()
      : undefined
    const remainingMs = nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - Date.now()) : undefined

    if (active) {
      return {
        enabled: true,
        paused: false,
        idleMinutes: autonomy.idleMinutes,
        routerAgentId: autonomy.routerAgentId,
        status: 'running',
        idleSince,
        nextRunAt,
        remainingMs,
        activeRunId: active.runId !== 'pending' ? active.runId : undefined,
        lastResult: autonomy.lastResult
      }
    }

    if (activeRuns.length > 0) {
      return {
        enabled: true,
        paused: false,
        idleMinutes: autonomy.idleMinutes,
        routerAgentId: autonomy.routerAgentId,
        status: 'waiting',
        idleSince,
        nextRunAt,
        remainingMs,
        lastResult: autonomy.lastResult
      }
    }

    return {
      enabled: true,
      paused: false,
      idleMinutes: autonomy.idleMinutes,
      routerAgentId: autonomy.routerAgentId,
      status: remainingMs !== undefined && remainingMs <= 0 ? 'ready' : 'waiting',
      idleSince,
      nextRunAt,
      remainingMs,
      lastResult: autonomy.lastResult
    }
  }

  private async buildExecutionPrompt(
    roomId: string,
    target: WorkerRuntimeInstance,
    userTask: string,
    metadata?: TaskMessageMetadata
  ): Promise<string> {
    const [messages, members, runs] = await Promise.all([
      collaborationService.listRoomMessages(roomId),
      collaborationService.listRoomMembers(roomId),
      collaborationService.listRoomRuns(roomId)
    ])
    const attachments = Array.isArray(metadata?.attachments) ? metadata.attachments.filter(isFileAttachment) : []
    const reasoningEffort = typeof metadata?.reasoningEffort === 'string' ? metadata.reasoningEffort : undefined
    const permissionMode = typeof metadata?.permissionMode === 'string' ? metadata.permissionMode : undefined
    const toolsEnabled = metadata?.toolsEnabled !== false

    return [
      `你正在处理讨论组任务。目标执行实例：${target.label}。`,
      '',
      '当前任务：',
      userTask,
      ...(reasoningEffort ? ['', `本轮思考强度：${reasoningEffort}`] : []),
      ...(permissionMode ? [`本轮权限模式：${permissionMode}`] : []),
      ...(!toolsEnabled ? ['本轮要求：除非绝对必要，不要调用工具；优先直接给出结论或方案。'] : []),
      ...(attachments.length > 0
        ? ['', '相关附件：', ...attachments.map((file) => `- ${file.origin_name} | ${file.type} | ${file.path}`)]
        : []),
      '',
      '讨论组成员：',
      ...members.map((member) => `- ${member.memberType}:${member.displayName ?? member.memberId}`),
      '',
      '最近讨论记录：',
      ...messages.slice(-16).map((message) => `- [${message.authorType}] ${message.content}`),
      '',
      '最近运行记录：',
      ...runs
        .slice(0, 6)
        .map((run) => `- ${run.workerAgentId} | ${run.status} | ${run.summary ?? run.result ?? run.error ?? ''}`),
      '',
      '请直接执行任务，并给出最终结果。'
    ].join('\n')
  }

  private async getHealthyRoomInstances(
    room: CollaborationRoomRecord,
    members: Awaited<ReturnType<typeof collaborationService.listRoomMembers>>,
    families: WorkerRuntimeFamily[],
    options: { includeRouter: boolean }
  ): Promise<WorkerRuntimeInstance[]> {
    const familyInstances = new Map<string, WorkerRuntimeInstance>()
    for (const family of families) {
      for (const instance of family.instances) {
        familyInstances.set(instance.agent.id, instance)
      }
    }

    const instances = members
      .filter((member) => member.memberType === 'agent')
      .map((member) => familyInstances.get(member.memberId))
      .filter((instance): instance is WorkerRuntimeInstance => Boolean(instance?.canRun))
      .filter((instance) => instance.agent.configuration?.autonomy_enabled !== false)

    const routerAgentId = room.autonomy.routerAgentId
    if (!options.includeRouter && routerAgentId) {
      return instances.filter((instance) => instance.agent.id !== routerAgentId)
    }
    return instances
  }

  private async resolveRouterInstance(
    room: CollaborationRoomRecord,
    families: WorkerRuntimeFamily[]
  ): Promise<WorkerRuntimeInstance | null> {
    const members = await collaborationService.listRoomMembers(room.id)
    const roomAgentIds = new Set(
      members.filter((member) => member.memberType === 'agent').map((member) => member.memberId)
    )
    const workspace = await collaborationService.getWorkspace(room.workspaceId)
    const instances = families.flatMap((family) => family.instances)
    const byId = new Map(instances.map((instance) => [instance.agent.id, instance]))
    const preferredIds = [room.autonomy.routerAgentId, workspace?.routerAgentId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )

    for (const agentId of preferredIds) {
      const preferred = byId.get(agentId)
      if (preferred?.canRun) return preferred
    }

    for (const family of families) {
      const healthyRoomLeader = family.instances.find(
        (instance) =>
          instance.canRun &&
          roomAgentIds.has(instance.agent.id) &&
          instance.agent.configuration?.autonomy_enabled !== false
      )
      if (healthyRoomLeader) {
        return healthyRoomLeader
      }
    }

    for (const family of families) {
      const healthyPrimaryLeader =
        family.instances.find(
          (instance) =>
            instance.canRun && instance.role === 'primary' && instance.agent.configuration?.autonomy_enabled !== false
        ) ??
        family.instances.find((instance) => instance.canRun && instance.agent.configuration?.autonomy_enabled !== false)
      if (healthyPrimaryLeader) {
        return healthyPrimaryLeader
      }
    }

    return null
  }

  private readTargetAgentId(metadata: Record<string, unknown> | null | undefined): string | undefined {
    return typeof metadata?.targetAgentId === 'string' ? metadata.targetAgentId : undefined
  }

  private readAutonomySource(metadata: Record<string, unknown> | null | undefined): 'manual' | 'idle' | undefined {
    return metadata?.autonomySource === 'idle' ? 'idle' : metadata?.autonomySource === 'manual' ? 'manual' : undefined
  }

  private async getLatestSession(agentId: string) {
    const { sessions } = await sessionService.listSessions(agentId, { limit: 1, offset: 0 })
    return sessions[0]
  }

  private async getOrCreateRoomSession(roomId: string, target: WorkerRuntimeInstance) {
    const runs = await collaborationService.listRoomRuns(roomId)
    const reusableRun = runs.find(
      (run) => run.workerAgentId === target.agent.id && run.sessionId && run.status === 'completed'
    )
    if (reusableRun?.sessionId) {
      const existing = await sessionService.getSession(target.agent.id, reusableRun.sessionId)
      if (existing) {
        return this.syncRoomSessionWithAgent(existing, target)
      }
    }

    const created = await sessionService.createSession(target.agent.id, {})
    if (!created) {
      throw new Error(`Failed to create session for ${target.agent.id}`)
    }
    const session = await sessionService.getSession(target.agent.id, created.id)
    if (!session) {
      throw new Error(`Failed to load session ${created.id}`)
    }
    return session
  }

  private async syncRoomSessionWithAgent(
    session: Awaited<ReturnType<typeof sessionService.getSession>>,
    target: WorkerRuntimeInstance
  ) {
    if (!session) {
      throw new Error(`Failed to load session for ${target.agent.id}`)
    }

    const updates: Parameters<typeof sessionService.updateSession>[2] = {}
    if (session.model !== target.agent.model) {
      updates.model = target.agent.model
    }
    if (session.plan_model !== target.agent.plan_model) {
      updates.plan_model = target.agent.plan_model
    }
    if (session.small_model !== target.agent.small_model) {
      updates.small_model = target.agent.small_model
    }

    if (Object.keys(updates).length === 0) {
      return session
    }

    return (await sessionService.updateSession(target.agent.id, session.id, updates)) ?? session
  }

  private readHasStderrFromChunk(part: TextStreamPart<Record<string, any>>): boolean {
    if (!('providerMetadata' in part)) return false
    const providerMetadata = (part as { providerMetadata?: unknown }).providerMetadata
    if (!providerMetadata || typeof providerMetadata !== 'object') return false
    const record = providerMetadata as Record<string, unknown>
    const workerMetadata = record.command_worker
    if (!workerMetadata || typeof workerMetadata !== 'object') return false
    return (workerMetadata as Record<string, unknown>).hasStderr === true
  }

  private async collectResponse(
    stream: ReadableStream<TextStreamPart<Record<string, any>>>,
    onText?: (snapshot: StreamTextSnapshot, force?: boolean) => Promise<void>
  ): Promise<StreamTextSnapshot> {
    const reader = stream.getReader()
    let completedText = ''
    let currentBlockText = ''
    let lastPushedAt = 0
    let hasStderr = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      hasStderr = hasStderr || this.readHasStderrFromChunk(value)

      switch (value.type) {
        case 'text-delta':
          if (value.text) {
            currentBlockText += value.text
            const joined = (completedText + currentBlockText).replace(/\n+$/, '')
            const now = Date.now()
            if (onText && now - lastPushedAt >= 250) {
              lastPushedAt = now
              await onText({ text: joined, hasStderr }, false)
            }
          }
          break
        case 'text-end':
          if (currentBlockText) {
            completedText += currentBlockText + '\n\n'
            currentBlockText = ''
          }
          break
        default:
          break
      }
    }

    const finalSnapshot: StreamTextSnapshot = {
      text: (completedText + currentBlockText).replace(/\n+$/, ''),
      hasStderr
    }
    if (onText) {
      await onText(finalSnapshot, true)
    }
    return finalSnapshot
  }

  private async hasPendingSimilarTask(workspaceId: string, title: string, content: string): Promise<boolean> {
    const rooms = await collaborationService.listRooms(workspaceId)
    const normalizedTitle = this.normalizeText(title)
    const normalizedContent = this.normalizeText(content)

    return rooms.some((room) => {
      if (room.status === 'done') return false
      const roomTitle = this.normalizeText(room.title)
      const roomContent = this.normalizeText(String(room.metadata?.seedContent ?? ''))
      return roomTitle === normalizedTitle || (roomContent && roomContent === normalizedContent)
    })
  }

  private normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ')
  }
}

export const collaborationRuntimeService = CollaborationRuntimeService.getInstance()

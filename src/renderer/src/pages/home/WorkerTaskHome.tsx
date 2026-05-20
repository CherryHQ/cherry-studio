import type {
  CollaborationRoom,
  CollaborationRoomAutonomyState,
  CollaborationRoomMember,
  CollaborationRoomMessage,
  CollaborationRoomRun,
  CollaborationWorkerFamilyRuntime,
  CollaborationWorkerInstanceRuntime
} from '@renderer/api/collaboration'
import ClaudeCodeAvatar from '@renderer/assets/worker-avatars/claude-code.png'
import CodexAvatar from '@renderer/assets/worker-avatars/codex.png'
import GeminiAvatar from '@renderer/assets/worker-avatars/gemini.png'
import HermesAvatar from '@renderer/assets/worker-avatars/hermes.png'
import OpenCodeAvatar from '@renderer/assets/worker-avatars/opencode.png'
import Sortable from '@renderer/components/dnd/Sortable'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import Scrollbar from '@renderer/components/Scrollbar'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { permissionModeCards } from '@renderer/config/agent'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useAgentClient } from '@renderer/hooks/agents/useAgentClient'
import { useCollaborationClient } from '@renderer/hooks/collaboration/useCollaborationClient'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { getModel } from '@renderer/hooks/useModel'
import AgentSessionInputbar from '@renderer/pages/agents/components/AgentSessionInputbar'
import AgentSessionMessages from '@renderer/pages/agents/components/AgentSessionMessages'
import CollaborationRunTranscript from '@renderer/pages/home/components/CollaborationRunTranscript'
import AttachmentPreview from '@renderer/pages/home/Inputbar/AttachmentPreview'
import { FileNameRender, getFileIcon } from '@renderer/pages/home/Inputbar/AttachmentPreview'
import FileManager from '@renderer/services/FileManager'
import { useAppSelector } from '@renderer/store'
import type { AgentStyleMode, FileMetadata, Model, PermissionMode, ThinkingOption } from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import type { MobileToolbarAction, MobileToolbarSnapshot } from '@shared/types/mobileToolbar'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Avatar, Button, Dropdown, Empty, Input, Popover, Segmented, Spin, Switch, Tag, Tooltip } from 'antd'
import {
  Activity,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Command,
  Copy,
  Crown,
  Database,
  Github,
  Globe2,
  GripVertical,
  Link,
  Loader2,
  Mail,
  MessageSquarePlus,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Route,
  Smartphone,
  Square,
  SquareDashed,
  UserPlus,
  Users,
  Wrench
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

type WorkerFamily = CollaborationWorkerFamilyRuntime
type WorkerInstance = CollaborationWorkerInstanceRuntime
type TaskAttachment = FileMetadata

const mediaExtensions = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.mkv'
]
const workerAvatarMap = {
  codex: CodexAvatar,
  'claude-code': ClaudeCodeAvatar,
  opencode: OpenCodeAvatar,
  'gemini-cli': GeminiAvatar,
  hermes: HermesAvatar
} as const
const reasoningOptions: Array<{ label: string; value: ThinkingOption }> = [
  { label: '默认', value: 'default' },
  { label: '关闭', value: 'none' },
  { label: '轻度', value: 'low' },
  { label: '中等', value: 'medium' },
  { label: '深入', value: 'high' },
  { label: '超强', value: 'xhigh' }
]

const normalizePath = (value: string) => value.replace(/\\/g, '/')
const getAvatarSource = (family?: WorkerFamily['key']) => (family ? workerAvatarMap[family] : undefined)

const splitProviderModelId = (value?: string | null) => {
  if (!value) return null
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return { providerId: undefined, modelId: value }
  }
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1)
  }
}

const readMessageAttachments = (message: CollaborationRoomMessage): TaskAttachment[] => {
  const attachments = message.metadata?.attachments
  if (!Array.isArray(attachments)) return []
  return attachments.filter((item): item is TaskAttachment =>
    Boolean(item && typeof item === 'object' && 'path' in item)
  )
}

const styleModeOptions: Array<{ label: string; value: AgentStyleMode }> = [
  { label: '正常', value: 'normal' },
  { label: '创意', value: 'creative' },
  { label: '严肃', value: 'serious' }
]

const MOBILE_TOOLBAR_BUILD = 'mobile-toolbar-20260508-2'
const mobileReasoningCycle: ThinkingOption[] = ['default', 'low', 'medium', 'high', 'xhigh', 'none']

const quickMcpApps = [
  {
    name: '@cherry/browser',
    label: '浏览器',
    description: '网页查看与操作',
    icon: Globe2
  },
  {
    name: 'GitHub',
    label: 'GitHub',
    description: '仓库、Issue、PR',
    icon: Github
  },
  {
    name: 'Gmail',
    label: 'Gmail',
    description: '邮件读取与发送',
    icon: Mail
  },
  {
    name: 'Hugging Face',
    label: 'Hugging Face',
    description: '模型与账号工具',
    icon: Database
  }
] as const

const statusLabels: Record<CollaborationRoom['status'], string> = {
  todo: '待办',
  in_progress: '进行中',
  needs_confirmation: '待确认',
  done: '已完成',
  blocked: '已阻塞'
}

const modelFilter = (model: Model) => !isEmbeddingModel(model) && !isRerankModel(model)

const readHasStderr = (message: CollaborationRoomMessage) => {
  const stream = message.metadata?.stream
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) return false
  return (stream as Record<string, unknown>).hasStderr === true
}

const shouldCollapseMessage = (message: CollaborationRoomMessage) => {
  const contentLength = message.content.length
  return message.authorType === 'system' || readHasStderr(message) || contentLength > 1800
}

const getCurrentInstanceModel = (instance?: WorkerInstance | null): Model | null => {
  const parsedDisplayModel = splitProviderModelId(instance?.displayModelId ?? instance?.agent.model)
  if (instance?.displayModelName) {
    return {
      id: parsedDisplayModel?.modelId ?? instance.displayModelId ?? instance.agent.model,
      provider: parsedDisplayModel?.providerId ?? 'local',
      name: instance.displayModelName,
      group: 'text'
    }
  }

  const modelId = instance?.agent.model
  if (!modelId) return null
  const parsedModel = splitProviderModelId(modelId)
  const existing = parsedModel?.providerId ? getModel(parsedModel.modelId, parsedModel.providerId) : getModel(modelId)
  if (existing) return existing
  return {
    id: parsedModel?.modelId ?? modelId,
    provider: parsedModel?.providerId ?? 'local',
    name: `${modelId}（待选择）`,
    group: 'text'
  }
}

const isWorkerManagedModel = (instance?: WorkerInstance | null) => instance?.modelManagedBy === 'worker'
const getModelSourceLabel = (instance?: WorkerInstance | null) =>
  isWorkerManagedModel(instance) ? '框架当前' : 'Cherry 指定'

const runStatusLabels: Record<CollaborationRoomRun['status'], string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已中止'
}

const autonomyStatusLabels: Record<CollaborationRoomAutonomyState['status'], string> = {
  disabled: '未开启',
  paused: '已暂停',
  waiting: '等待空闲',
  running: '自主执行中',
  ready: '空闲可触发'
}

const getRoomStatusLabel = (room: CollaborationRoom) => {
  if (room.status === 'todo' && !room.assignedAgentId) {
    return '待整理'
  }
  return statusLabels[room.status]
}

const formatCountdown = (remainingMs?: number) => {
  if (remainingMs === undefined) return '未开始计时'
  if (remainingMs <= 0) return '现在可触发'
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

type DisplayTaskStatus = 'backlog' | 'todo' | 'in_progress' | 'needs_confirmation' | 'done'

const displayTaskStatusLabels: Record<DisplayTaskStatus, string> = {
  backlog: '待整理',
  todo: '待办',
  in_progress: '进行中',
  needs_confirmation: '待确认',
  done: '已完成'
}

const buildFreshSessionTitle = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `新会话 ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const WorkerTaskHome = () => {
  const qc = useQueryClient()
  const client = useCollaborationClient()
  const agentClient = useAgentClient()
  const { apiServerConfig, apiServerRunning, apiServerLoading, startApiServer } = useApiServer()
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const [sideTab, setSideTab] = useState<'workers' | 'tasks'>('workers')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<WorkerFamily['key']>('codex')
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions')
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [workerListView, setWorkerListView] = useState<WorkerFamily[]>([])
  const startupSessionPreparedRef = useRef(false)
  const initializedSessionAgentsRef = useRef<Set<string>>(new Set())
  const [sessionByAgentId, setSessionByAgentId] = useState<Record<string, string>>({})
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  void DynamicVirtualList
  void AttachmentPreview
  void CollaborationRunTranscript
  void Dropdown
  void Input
  void BrainCircuit
  void Command
  void Paperclip
  void Route
  void Wrench

  const canUseTasks = apiServerConfig.enabled && apiServerRunning

  const { data: workers = [], isLoading: workersLoading } = useQuery({
    queryKey: ['collaboration', 'workers'],
    queryFn: () => client.listWorkers(),
    enabled: canUseTasks,
    refetchInterval: 60000, // [Optimization] 降低 Worker 列表的轮询频率至 1 分钟
    refetchIntervalInBackground: false
  })

  useEffect(() => {
    setWorkerListView(workers)
  }, [workers])

  const selectedFamily = workers.find((worker) => worker.key === selectedFamilyKey) ?? workers[0]

  useEffect(() => {
    if (workers.length > 0 && !workers.some((worker) => worker.key === selectedFamilyKey)) {
      setSelectedFamilyKey(workers[0].key)
    }
  }, [selectedFamilyKey, workers])

  useEffect(() => {
    if (!selectedFamily) {
      setSelectedInstanceId(null)
      return
    }
    const availableInstances = selectedFamily.instances
    if (availableInstances.length === 0) {
      setSelectedInstanceId(null)
      return
    }
    if (!selectedInstanceId || !availableInstances.some((instance) => instance.agent.id === selectedInstanceId)) {
      setSelectedInstanceId(availableInstances[0].agent.id)
    }
  }, [selectedFamily, selectedInstanceId])

  const selectedInstance =
    selectedFamily?.instances.find((instance) => instance.agent.id === selectedInstanceId) ??
    selectedFamily?.instances[0]
  const selectedInstanceCanRun = Boolean(selectedInstance?.canRun)

  const { data: workspaces = [], isLoading: workspacesLoading } = useQuery({
    queryKey: ['collaboration', 'workspaces'],
    queryFn: () => client.listWorkspaces(),
    enabled: canUseTasks,
    staleTime: Infinity // [Optimization] 工作区列表很少变动，不再主动刷新
  })

  const { data: mobileInfo } = useQuery({
    queryKey: ['collaboration', 'mobile-info'],
    queryFn: () => client.getMobileAccessInfo(),
    enabled: canUseTasks,
    staleTime: Infinity
  })

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['collaboration', 'rooms', selectedWorkspaceId],
    queryFn: () => client.listRooms(selectedWorkspaceId!),
    enabled: canUseTasks && Boolean(selectedWorkspaceId),
    refetchInterval: false, // [Optimization] 房间列表由用户操作主动刷新
    refetchIntervalInBackground: false
  })

  useEffect(() => {
    if (!selectedRoomId) return
    if (!rooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(rooms[0]?.id ?? null)
    }
  }, [rooms, selectedRoomId])

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId) ?? null, [rooms, selectedRoomId])

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['collaboration', 'room-members', selectedRoomId],
    queryFn: () => client.listRoomMembers(selectedRoomId!),
    enabled: canUseTasks && Boolean(selectedRoomId),
    refetchInterval: rightCollapsed ? false : selectedRoom?.status === 'in_progress' ? 10000 : false,
    refetchIntervalInBackground: false
  })

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['collaboration', 'room-messages', selectedRoomId],
    queryFn: () => client.listRoomMessages(selectedRoomId!),
    enabled: canUseTasks && Boolean(selectedRoomId),
    refetchInterval: selectedRoom?.status === 'in_progress' ? 800 : 6000,
    refetchIntervalInBackground: false
  })
  void messages

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['collaboration', 'room-runs', selectedRoomId],
    queryFn: () => client.listRoomRuns(selectedRoomId!),
    enabled: canUseTasks && Boolean(selectedRoomId),
    refetchInterval: selectedRoom?.status === 'in_progress' ? 900 : 6000,
    refetchIntervalInBackground: false
  })

  const { data: autonomyState, isLoading: autonomyLoading } = useQuery({
    queryKey: ['collaboration', 'room-autonomy', selectedRoomId],
    queryFn: () => client.getRoomAutonomy(selectedRoomId!),
    enabled: canUseTasks && Boolean(selectedRoomId),
    refetchInterval: rightCollapsed ? false : selectedRoom?.status === 'in_progress' ? 5000 : 20000,
    refetchIntervalInBackground: false
  })

  const instanceMap = useMemo(() => {
    const map = new Map<string, WorkerInstance>()
    for (const family of workers) {
      for (const instance of family.instances) {
        map.set(instance.agent.id, instance)
      }
    }
    return map
  }, [workers])

  const roomInstances = useMemo(
    () =>
      members
        .filter((member) => member.memberType === 'agent')
        .map((member) => ({
          member,
          instance: instanceMap.get(member.memberId)
        }))
        .filter((entry): entry is { member: CollaborationRoomMember; instance: WorkerInstance } =>
          Boolean(entry.instance)
        ),
    [instanceMap, members]
  )

  const assignedInstance = selectedRoom?.assignedAgentId ? instanceMap.get(selectedRoom.assignedAgentId) : undefined
  const activeInstance = selectedInstance ?? assignedInstance
  const modelSwitchInstance = selectedInstance ?? assignedInstance
  const modelSwitchModel = getCurrentInstanceModel(modelSwitchInstance)
  const activeRun = runs.find((run) => run.status === 'queued' || run.status === 'running')
  const displayedRun = activeRun ?? runs[0]
  void displayedRun
  const selectedInstanceBusy = Boolean(selectedInstance && selectedInstance.workload.activeRuns > 0)
  const commandMode = draft.trimStart().startsWith('/plan') ? 'plan' : 'plain'

  const ensureInstanceSession = async (instance: WorkerInstance) => {
    const existingSessionId = sessionByAgentId[instance.agent.id]
    if (existingSessionId) {
      return existingSessionId
    }

    const shouldCreateFresh = !initializedSessionAgentsRef.current.has(instance.agent.id)
    let sessionId: string | undefined

    if (!shouldCreateFresh) {
      const listed = await agentClient.listSessions(instance.agent.id, { limit: 1, offset: 0 })
      sessionId = listed.data[0]?.id
    }

    if (!sessionId) {
      const created = await agentClient.createSession(instance.agent.id, {
        name: buildFreshSessionTitle(),
        model: instance.agent.model || 'worker:external',
        accessible_paths: instance.agent.accessible_paths ?? []
      })
      sessionId = created.id
    }

    initializedSessionAgentsRef.current.add(instance.agent.id)
    setSessionByAgentId((previous) => ({ ...previous, [instance.agent.id]: sessionId! }))
    return sessionId
  }

  useEffect(() => {
    if (!canUseTasks || !selectedInstance) {
      setActiveSessionId(null)
      return
    }

    let cancelled = false
    setSessionLoading(true)
    void ensureInstanceSession(selectedInstance)
      .then((sessionId) => {
        if (cancelled) return
        setActiveSessionId(sessionId)
      })
      .catch((error) => {
        if (cancelled) return
        setActiveSessionId(null)
        window.toast.error(error instanceof Error ? error.message : '创建实例会话失败')
      })
      .finally(() => {
        if (!cancelled) {
          setSessionLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [canUseTasks, selectedInstance?.agent.id])
  const workspaceStatusCounts = useMemo(
    () =>
      rooms.reduce<Record<CollaborationRoom['status'], number>>(
        (counts, room) => {
          counts[room.status] += 1
          return counts
        },
        {
          todo: 0,
          in_progress: 0,
          needs_confirmation: 0,
          done: 0,
          blocked: 0
        }
      ),
    [rooms]
  )
  const pendingRooms = useMemo(
    () =>
      [...rooms]
        .filter((room) => room.status !== 'done')
        .sort((left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime()),
    [rooms]
  )
  const quickMcpStatuses = useMemo(
    () =>
      quickMcpApps.map((app) => {
        const server = mcpServers.find((item) => item.name === app.name)
        return {
          ...app,
          active: server?.isActive === true,
          configured: Boolean(server) && server?.shouldConfig !== true
        }
      }),
    [mcpServers]
  )
  const workerRuntimeSummary = useMemo(() => {
    const allInstances = workers.flatMap((worker) => worker.instances)
    const online = allInstances.filter((instance) => instance.status === 'online').length
    const running = allInstances.filter((instance) => instance.status === 'running').length
    const unavailable = allInstances.filter((instance) => !instance.canRun).length
    return {
      total: allInstances.length,
      online,
      running,
      unavailable
    }
  }, [workers])
  const progressStatusPopoverContent = useMemo(() => {
    const statusRooms = {
      backlog: pendingRooms.filter((room) => room.status === 'todo' && !room.assignedAgentId),
      todo: pendingRooms.filter((room) => room.status === 'todo' && room.assignedAgentId),
      in_progress: pendingRooms.filter((room) => room.status === 'in_progress'),
      needs_confirmation: pendingRooms.filter((room) => room.status === 'needs_confirmation'),
      done: rooms
        .filter((room) => room.status === 'done')
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    } satisfies Record<DisplayTaskStatus, CollaborationRoom[]>

    const buildContent = (status: DisplayTaskStatus) => (
      <StatusPopover>
        <StatusPopoverHeader>
          <div>
            <strong>{displayTaskStatusLabels[status]}</strong>
            <span>{statusRooms[status].length} 个任务</span>
          </div>
        </StatusPopoverHeader>
        <StatusMetricRow>
          <StatusMetricCard>
            <label>实例总数</label>
            <strong>{workerRuntimeSummary.total}</strong>
          </StatusMetricCard>
          <StatusMetricCard>
            <label>在线</label>
            <strong>{workerRuntimeSummary.online}</strong>
          </StatusMetricCard>
          <StatusMetricCard>
            <label>运行中</label>
            <strong>{workerRuntimeSummary.running}</strong>
          </StatusMetricCard>
          <StatusMetricCard>
            <label>不可用</label>
            <strong>{workerRuntimeSummary.unavailable}</strong>
          </StatusMetricCard>
        </StatusMetricRow>
        <StatusWorkersList>
          {workers.map((worker) => (
            <StatusWorkerRow key={worker.key}>
              <WorkerAvatar src={getAvatarSource(worker.key)} size={22} />
              <div>
                <strong>{worker.label}</strong>
                <span>
                  {worker.healthLabel} · {worker.workload.label}
                </span>
              </div>
            </StatusWorkerRow>
          ))}
        </StatusWorkersList>
        <StatusRoomsList>
          {statusRooms[status].length === 0 ? (
            <StatusEmpty>当前没有这个状态的任务</StatusEmpty>
          ) : (
            statusRooms[status].slice(0, 6).map((room) => (
              <StatusRoomRow key={room.id}>
                <strong>{room.title}</strong>
                <span>
                  {room.assignedAgentId ? (instanceMap.get(room.assignedAgentId)?.label ?? '已指派') : '未指派'}
                </span>
              </StatusRoomRow>
            ))
          )}
        </StatusRoomsList>
      </StatusPopover>
    )

    return {
      backlog: buildContent('backlog'),
      todo: buildContent('todo'),
      in_progress: buildContent('in_progress'),
      needs_confirmation: buildContent('needs_confirmation'),
      done: buildContent('done')
    } satisfies Record<DisplayTaskStatus, ReactNode>
  }, [instanceMap, pendingRooms, rooms, workerRuntimeSummary, workers])

  useEffect(() => {
    setAttachments([])
  }, [selectedRoomId])

  useEffect(() => {
    const config = (selectedInstance?.agent.configuration ?? assignedInstance?.agent.configuration) as
      | { permission_mode?: PermissionMode }
      | undefined
    setPermissionMode(config?.permission_mode ?? 'bypassPermissions')
  }, [assignedInstance?.agent.configuration, selectedInstance?.agent.configuration])

  const getAttachmentWorkspaceRoot = () => {
    const root = selectedInstance?.agent.accessible_paths?.[0] ?? assignedInstance?.agent.accessible_paths?.[0]
    return root ? normalizePath(root) : null
  }

  const addAttachments = async () => {
    if (!selectedRoom || attaching) return
    const workspaceRoot = getAttachmentWorkspaceRoot()
    if (!workspaceRoot) {
      window.toast.warning('先选一个可运行实例，再添加图片、音频或视频')
      return
    }

    setAttaching(true)
    try {
      const selectedFiles =
        (await window.api.file.select({
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: 'Media',
              extensions: mediaExtensions.map((ext) => ext.slice(1))
            }
          ]
        })) ?? []

      if (selectedFiles.length === 0) return

      const uploadedFiles = await FileManager.uploadFiles(selectedFiles)
      const attachmentDir = normalizePath(`${workspaceRoot}/.cherry-task-attachments/${selectedRoom.id}`)
      await window.api.file.mkdir(attachmentDir)

      const copiedFiles = await Promise.all(
        uploadedFiles.map(async (file) => {
          const { safeName } = await window.api.file.checkFileName(attachmentDir, file.origin_name, true)
          const targetPath = normalizePath(`${attachmentDir}/${safeName}`)
          await window.api.file.copy(file.id, targetPath)
          const copied = await window.api.file.get(targetPath)
          return copied ? { ...copied, origin_name: file.origin_name } : { ...file, path: targetPath, name: safeName }
        })
      )

      setAttachments((current) => {
        const seen = new Set(current.map((item) => item.path))
        return [...current, ...copiedFiles.filter((item) => !seen.has(item.path))]
      })
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : '添加附件失败')
    } finally {
      setAttaching(false)
    }
  }

  const ensureWorkspace = async () => {
    if (selectedWorkspaceId) return selectedWorkspaceId
    if (workspaces[0]?.id) return workspaces[0].id
    const workspace = await client.createWorkspace({ name: '本机任务台' })
    await qc.invalidateQueries({ queryKey: ['collaboration', 'workspaces'] })
    setSelectedWorkspaceId(workspace.id)
    return workspace.id
  }

  const updateInstanceModel = async (instance: WorkerInstance) => {
    const currentModel = getCurrentInstanceModel(instance)
    const nextModel = await SelectChatModelPopup.show({ model: currentModel ?? undefined, filter: modelFilter })
    if (!nextModel) return false
    const providerId = nextModel.provider?.trim()
    if (!providerId) {
      window.toast.warning('当前模型缺少服务商标识，无法保存为 Worker 模型。')
      return false
    }

    const nextModelId = `${providerId}:${nextModel.id}`
    try {
      const currentConfig = AgentConfigurationSchema.parse(instance.agent.configuration ?? {})
      await agentClient.updateAgent({
        id: instance.agent.id,
        model: nextModelId,
        configuration: {
          ...currentConfig,
          worker_model_source: 'cherry',
          worker_detected_model: instance.displayModelId ?? currentConfig.worker_detected_model,
          worker_detected_model_name: instance.displayModelName ?? currentConfig.worker_detected_model_name
        }
      })
      await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
      window.toast.success(`实例 ${instance.label} 已切换模型：${nextModel.name}`)
      return true
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : '模型切换失败')
      return false
    }
  }

  const updateCurrentModel = async () => {
    if (!modelSwitchInstance) return
    const changed = await updateInstanceModel(modelSwitchInstance)
    if (changed) {
      setModelPanelOpen(false)
    }
  }

  const selectRoomFromModelPanel = (roomId: string) => {
    setSelectedRoomId(roomId)
    setModelPanelOpen(false)
  }

  const modelStatusPopoverContent = (
    <ModelStatusPopover>
      <ModelStatusSection>
        <ModelStatusHeader>
          <div>
            <strong>当前实例</strong>
            <span>{modelSwitchInstance?.label ?? '未指定实例'}</span>
          </div>
          <Button size="small" type="primary" disabled={!modelSwitchInstance} onClick={() => void updateCurrentModel()}>
            切换模型
          </Button>
        </ModelStatusHeader>
        <ModelStatusMetaGrid>
          <ModelStatusMetric>
            <label>有效模型</label>
            <strong>{modelSwitchModel?.name ?? '待选择'}</strong>
          </ModelStatusMetric>
          <ModelStatusMetric>
            <label>模型来源</label>
            <strong>{modelSwitchInstance ? getModelSourceLabel(modelSwitchInstance) : '未指定'}</strong>
          </ModelStatusMetric>
          <ModelStatusMetric>
            <label>运行状态</label>
            <strong>
              {activeRun ? runStatusLabels[activeRun.status] : selectedRoom ? getRoomStatusLabel(selectedRoom) : '待办'}
            </strong>
          </ModelStatusMetric>
        </ModelStatusMetaGrid>
      </ModelStatusSection>

      <ModelStatusSection>
        <ModelStatusTitle>当前工作区任务状态</ModelStatusTitle>
        <ModelStatusCountGrid>
          {(
            [
              ['todo', '待办'],
              ['in_progress', '进行中'],
              ['needs_confirmation', '待确认'],
              ['done', '已完成'],
              ['blocked', '已阻塞']
            ] as Array<[CollaborationRoom['status'], string]>
          ).map(([status, label]) => (
            <ModelStatusCountCard key={status}>
              <span>{label}</span>
              <strong>{workspaceStatusCounts[status]}</strong>
            </ModelStatusCountCard>
          ))}
        </ModelStatusCountGrid>
      </ModelStatusSection>

      <ModelStatusSection>
        <ModelStatusTitle>待办事项</ModelStatusTitle>
        {pendingRooms.length === 0 ? (
          <ModelStatusEmpty>当前工作区没有未完成任务。</ModelStatusEmpty>
        ) : (
          <ModelTodoList>
            {pendingRooms.map((room) => {
              const assignedLabel = room.assignedAgentId
                ? (instanceMap.get(room.assignedAgentId)?.label ?? '已指派')
                : '未指派'
              return (
                <ModelTodoItem
                  key={room.id}
                  $active={room.id === selectedRoomId}
                  onClick={() => selectRoomFromModelPanel(room.id)}>
                  <ModelTodoMain>
                    <strong>{room.title}</strong>
                    <span>
                      {getRoomStatusLabel(room)} · {assignedLabel}
                    </span>
                  </ModelTodoMain>
                  {room.status === 'in_progress' && <ModelTodoRunning>运行中</ModelTodoRunning>}
                </ModelTodoItem>
              )
            })}
          </ModelTodoList>
        )}
      </ModelStatusSection>
    </ModelStatusPopover>
  )

  const reorderWorkers = async (nextWorkers: WorkerFamily[]) => {
    setWorkerListView(nextWorkers)
    try {
      await client.reorderWorkers(nextWorkers.map((worker) => worker.key))
      await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
      window.toast.success(`Worker 顺序已更新，当前主控优先级是 ${nextWorkers[0]?.label ?? '未指定'}`)
    } catch (error) {
      setWorkerListView(workers)
      window.toast.error(error instanceof Error ? error.message : '更新 Worker 顺序失败')
    }
  }

  const refreshSelectedRoom = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['collaboration', 'rooms', selectedWorkspaceId] }),
      qc.invalidateQueries({ queryKey: ['collaboration', 'room-members', selectedRoomId] }),
      qc.invalidateQueries({ queryKey: ['collaboration', 'room-messages', selectedRoomId] }),
      qc.invalidateQueries({ queryKey: ['collaboration', 'room-runs', selectedRoomId] }),
      qc.invalidateQueries({ queryKey: ['collaboration', 'room-autonomy', selectedRoomId] }),
      qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
    ])
  }

  const resolveTargetInstance = async (): Promise<WorkerInstance | undefined> => {
    if (selectedInstance?.canRun) return selectedInstance

    const fallbackExisting = selectedFamily?.instances.find((instance) => instance.canRun)
    if (fallbackExisting) {
      if (fallbackExisting.agent.id !== selectedInstanceId) {
        setSelectedInstanceId(fallbackExisting.agent.id)
      }
      return fallbackExisting
    }

    if (!selectedFamily || selectedFamily.instances.length > 0 || !selectedFamily.canRun) {
      return undefined
    }

    const autoBoundFamily = await client.bindWorker(selectedFamily.type)
    await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
    const autoBoundInstance =
      autoBoundFamily.instances.find((instance) => instance.canRun) ?? autoBoundFamily.instances[0]
    if (autoBoundInstance) {
      setSelectedInstanceId(autoBoundInstance.agent.id)
      window.toast.success(`${selectedFamily.label} 已自动创建实例`)
    }
    return autoBoundInstance
  }

  const createTask = async () => {
    if (!canUseTasks) return
    const title = await PromptPopup.show({
      title: '新建任务',
      message: '',
      defaultValue: '新的制作任务'
    })
    if (!title?.trim()) return

    const workspaceId = await ensureWorkspace()
    const targetInstance = await resolveTargetInstance()
    const targetAgentId = targetInstance?.agent.id
    const room = await client.createRoom({
      workspaceId,
      title: title.trim(),
      status: 'todo',
      metadata: {
        seedContent: title.trim()
      }
    })
    if (targetAgentId) {
      const result = await client.assignAndRun(room.id, {
        targetAgentId,
        content: title.trim()
      })
      if (result.status === 'deferred') {
        window.toast.warning(result.eventMessage)
      }
    } else {
      await client.createRoomMessage(room.id, {
        authorType: 'user',
        kind: 'task',
        intent: 'task',
        routing: 'none',
        content: title.trim()
      })
    }
    await qc.invalidateQueries({ queryKey: ['collaboration', 'rooms', workspaceId] })
    setSelectedRoomId(room.id)
    setSideTab('tasks')
  }

  const createFreshStartupSession = async () => {
    const workspaceId = await ensureWorkspace()
    const room = await client.createRoom({
      workspaceId,
      title: buildFreshSessionTitle(),
      status: 'todo',
      metadata: {
        startupFreshSession: true
      }
    })
    await qc.invalidateQueries({ queryKey: ['collaboration', 'rooms', workspaceId] })
    setSelectedRoomId(room.id)
    setDraft('')
    setAttachments([])
  }

  const copyMobileUrl = async () => {
    if (!mobileInfo?.mobileUrl) return
    await navigator.clipboard.writeText(mobileInfo.mobileUrl)
    window.toast.success('手机入口已复制')
  }

  const bindSelectedFamily = async () => {
    if (!selectedFamily) return
    try {
      await client.bindWorker(selectedFamily.type)
      await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
      window.toast.success(`${selectedFamily.label} 已绑定`)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : `${selectedFamily.label} 绑定失败`)
    }
  }

  const createSelectedInstance = async () => {
    if (!selectedFamily) return
    try {
      await client.createWorkerInstance(selectedFamily.type)
      await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
      window.toast.success(`${selectedFamily.label} 已创建新实例`)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : '新建实例失败')
    }
  }

  const updateInstanceStyle = async (instance: WorkerInstance, mode: AgentStyleMode) => {
    try {
      await agentClient.updateAgentStyleMode(instance.agent.id, mode)
      await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
      window.toast.success(`${instance.label} 已切换为 ${styleModeOptions.find((item) => item.value === mode)?.label}`)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : '风格模式切换失败')
    }
  }

  const updateInstancePermissionMode = async (instance: WorkerInstance, mode: PermissionMode) => {
    try {
      const currentConfig = AgentConfigurationSchema.parse(instance.agent.configuration ?? {})
      await agentClient.updateAgent({
        id: instance.agent.id,
        configuration: {
          ...currentConfig,
          permission_mode: mode
        }
      })
      setPermissionMode(mode)
      await qc.invalidateQueries({ queryKey: ['collaboration', 'workers'] })
      window.toast.success(
        `${instance.label} 已切换到${permissionModeCards.find((card) => card.mode === mode)?.titleFallback ?? mode}`
      )
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : '权限模式切换失败')
    }
  }

  const addInstanceToRoom = async (instance: WorkerInstance) => {
    if (!selectedRoom) return
    await client.createRoomMember(selectedRoom.id, {
      memberType: 'agent',
      memberId: instance.agent.id,
      displayName: instance.label
    })
    await refreshSelectedRoom()
  }

  const removeMemberFromRoom = async (member: CollaborationRoomMember) => {
    if (!selectedRoom) return
    await client.deleteRoomMember(selectedRoom.id, member.memberType, member.memberId)
    await refreshSelectedRoom()
  }

  const archiveCurrentSession = () => {
    if (!selectedInstance) return
    setSessionByAgentId((prev) => {
      const next = { ...prev }
      delete next[selectedInstance.agent.id]
      return next
    })
    initializedSessionAgentsRef.current.delete(selectedInstance.agent.id)
    setActiveSessionId(null)
  }

  const assignSelectedInstance = async () => {
    if (!selectedRoom || !selectedInstance) return
    const result = await client.assignAndRun(selectedRoom.id, {
      targetAgentId: selectedInstance.agent.id
    })
    if (result.status === 'deferred') {
      window.toast.warning(result.eventMessage)
    } else {
      window.toast.success(result.eventMessage)
    }
    await refreshSelectedRoom()
  }

  const publishTaskMessage = async () => {
    if (!selectedRoom || (!draft.trim() && attachments.length === 0)) return
    const targetInstance = await resolveTargetInstance()
    const targetAgentId = targetInstance?.agent.id
    const content = draft.trim() || '请查看附件并处理。'
    if (targetAgentId) {
      const result = await client.assignAndRun(selectedRoom.id, {
        targetAgentId,
        content,
        attachments,
        reasoningEffort,
        permissionMode,
        toolsEnabled
      })
      if (result.status === 'deferred') {
        window.toast.warning(result.eventMessage)
      } else {
        window.toast.success(result.eventMessage)
      }
    } else {
      await client.createRoomMessage(selectedRoom.id, {
        authorType: 'user',
        kind: 'task',
        intent: 'task',
        routing: 'none',
        content,
        metadata: {
          attachments,
          reasoningEffort,
          permissionMode,
          toolsEnabled
        }
      })
    }
    setDraft('')
    setAttachments([])
    await refreshSelectedRoom()
  }
  void publishTaskMessage

  const quickInsertPlanCommand = () => {
    setPermissionMode('plan')
    setDraft((current) => (current.trimStart().startsWith('/plan') ? current : `/plan ${current}`.trim()))
  }

  const setCommandMode = (mode: 'plain' | 'plan') => {
    if (mode === 'plan') {
      quickInsertPlanCommand()
      return
    }

    setDraft((current) => current.replace(/^\/plan\s*/u, ''))
    if (permissionMode === 'plan') {
      setPermissionMode('bypassPermissions')
    }
  }

  const publishMobileToolbar = (overrides?: {
    reasoningEffort?: ThinkingOption
    permissionMode?: PermissionMode
    toolsEnabled?: boolean
    commandMode?: 'plain' | 'plan'
    attachmentsCount?: number
    attaching?: boolean
  }) => {
    if (!window.api?.mobileToolbar) return

    const nextReasoning = overrides?.reasoningEffort ?? reasoningEffort
    const nextPermissionMode = overrides?.permissionMode ?? permissionMode
    const nextToolsEnabled = overrides?.toolsEnabled ?? toolsEnabled
    const nextCommandMode = overrides?.commandMode ?? commandMode
    const nextAttachmentsCount = overrides?.attachmentsCount ?? attachments.length
    const nextAttaching = overrides?.attaching ?? attaching

    const snapshot: MobileToolbarSnapshot = {
      build: MOBILE_TOOLBAR_BUILD,
      scope: 'chat',
      tools: [
        {
          key: 'attachment',
          label: '附件',
          icon: 'paperclip',
          active: nextAttachmentsCount > 0 || nextAttaching,
          enabled: !nextAttaching
        },
        {
          key: 'reasoning',
          label: `思考：${reasoningOptions.find((option) => option.value === nextReasoning)?.label ?? '默认'}`,
          icon: 'lightbulb',
          active: nextReasoning !== 'default' && nextReasoning !== 'none',
          enabled: true
        },
        {
          key: 'permission_mode',
          label: `模式：${permissionModeCards.find((card) => card.mode === nextPermissionMode)?.titleFallback ?? nextPermissionMode}`,
          icon: 'route',
          active: nextPermissionMode !== 'bypassPermissions' || nextCommandMode === 'plan',
          enabled: Boolean(selectedInstance)
        },
        {
          key: 'tools_toggle',
          label: `工具：${nextToolsEnabled ? '开启' : '关闭'}`,
          icon: 'wrench',
          active: nextToolsEnabled,
          enabled: true
        },
        {
          key: 'plan_command',
          label: `命令：${nextCommandMode === 'plan' ? '/plan' : '普通'}`,
          icon: 'command',
          active: nextCommandMode === 'plan',
          enabled: true
        }
      ]
    }

    void window.api.mobileToolbar.publish(snapshot)
  }

  useEffect(() => {
    publishMobileToolbar()
  }, [attachments.length, attaching, commandMode, permissionMode, reasoningEffort, selectedInstance, toolsEnabled])

  useEffect(() => {
    if (!window.api?.mobileToolbar) return

    const cleanup = window.api.mobileToolbar.onAction((action: MobileToolbarAction) => {
      if (action.action !== 'tap') return

      switch (action.key) {
        case 'attachment':
          if (!attaching) {
            void addAttachments()
          }
          break
        case 'reasoning': {
          const currentIndex = mobileReasoningCycle.indexOf(reasoningEffort)
          const nextReasoning = mobileReasoningCycle[(currentIndex + 1) % mobileReasoningCycle.length]
          setReasoningEffort(nextReasoning)
          publishMobileToolbar({ reasoningEffort: nextReasoning })
          break
        }
        case 'permission_mode': {
          if (!selectedInstance) break
          const currentIndex = permissionModeCards.findIndex((card) => card.mode === permissionMode)
          const nextCard = permissionModeCards[(currentIndex + 1) % permissionModeCards.length]
          void updateInstancePermissionMode(selectedInstance, nextCard.mode)
          publishMobileToolbar({ permissionMode: nextCard.mode })
          break
        }
        case 'tools_toggle': {
          const nextToolsEnabled = !toolsEnabled
          setToolsEnabled(nextToolsEnabled)
          publishMobileToolbar({ toolsEnabled: nextToolsEnabled })
          break
        }
        case 'plan_command': {
          const nextMode = commandMode === 'plan' ? 'plain' : 'plan'
          setCommandMode(nextMode)
          publishMobileToolbar({
            commandMode: nextMode,
            permissionMode:
              nextMode === 'plan' ? 'plan' : permissionMode === 'plan' ? 'bypassPermissions' : permissionMode
          })
          break
        }
        default:
          break
      }
    })

    return cleanup
  }, [addAttachments, attaching, commandMode, permissionMode, reasoningEffort, selectedInstance, toolsEnabled])

  useEffect(() => {
    return () => {
      void window.api?.mobileToolbar?.publish(null)
    }
  }, [])

  const setRoomRouter = async (instance: WorkerInstance) => {
    if (!selectedRoom) return
    await client.updateRoomAutonomy(selectedRoom.id, {
      enabled: autonomyState?.enabled ?? false,
      idleMinutes: autonomyState?.idleMinutes ?? 30,
      paused: false,
      routerAgentId: instance.agent.id
    })
    await refreshSelectedRoom()
  }

  const toggleAutonomy = async (enabled: boolean) => {
    if (!selectedRoom) return
    await client.updateRoomAutonomy(selectedRoom.id, {
      enabled,
      paused: enabled ? false : false,
      idleMinutes: autonomyState?.idleMinutes ?? 30,
      routerAgentId: autonomyState?.routerAgentId
    })
    await refreshSelectedRoom()
  }

  const runAutonomyNow = async () => {
    if (!selectedRoom) return
    await client.runRoomAutonomy(selectedRoom.id)
    await refreshSelectedRoom()
  }

  const stopAutonomy = async () => {
    if (!selectedRoom) return
    await client.stopRoomAutonomy(selectedRoom.id)
    await refreshSelectedRoom()
  }

  const stopActiveRun = async () => {
    if (!activeRun) return
    await client.stopRoomRun(activeRun.id)
    await refreshSelectedRoom()
  }

  useEffect(() => {
    if (!canUseTasks || workspacesLoading || startupSessionPreparedRef.current || selectedRoomId) {
      return
    }

    startupSessionPreparedRef.current = true
    void createFreshStartupSession().catch((error) => {
      startupSessionPreparedRef.current = false
      window.toast.error(error instanceof Error ? error.message : '创建启动会话失败')
    })
  }, [canUseTasks, selectedRoomId, workspacesLoading])

  useEffect(() => {
    console.info('[WorkerTaskHome] mounted', { canUseTasks, selectedWorkspaceId })
  }, [])

  if (!canUseTasks) {
    return (
      <TaskShell $leftCollapsed={leftCollapsed} $rightCollapsed={rightCollapsed}>
        <ServerGate>
          <Boxes size={28} />
          <h2>任务台需要启动本地服务</h2>
          <p>启动后就能创建任务、选择 Worker，并把协作记录保存在本机。</p>
          <Button type="primary" loading={apiServerLoading} onClick={() => void startApiServer()}>
            启动任务台
          </Button>
        </ServerGate>
      </TaskShell>
    )
  }

  return (
    <QuickPanelProvider>
      <TaskShell $leftCollapsed={leftCollapsed} $rightCollapsed={rightCollapsed}>
        <LeftPanel $collapsed={leftCollapsed}>
          {leftCollapsed ? (
            <CollapsedRail>
              <RailTop>
                <IconButton onClick={() => setLeftCollapsed(false)}>
                  <ChevronRight size={15} />
                </IconButton>
              </RailTop>
              <RailTabs>
                <RailTabButton
                  $active={sideTab === 'workers'}
                  onClick={() => {
                    setSideTab('workers')
                    setLeftCollapsed(false)
                  }}>
                  <Bot size={16} />
                </RailTabButton>
                <RailTabButton
                  $active={sideTab === 'tasks'}
                  onClick={() => {
                    setSideTab('tasks')
                    setLeftCollapsed(false)
                  }}>
                  <MessageSquarePlus size={16} />
                </RailTabButton>
              </RailTabs>
            </CollapsedRail>
          ) : (
            <>
              <PanelTabs>
                <PanelTab $active={sideTab === 'workers'} onClick={() => setSideTab('workers')}>
                  Worker
                </PanelTab>
                <PanelTab $active={sideTab === 'tasks'} onClick={() => setSideTab('tasks')}>
                  会话
                </PanelTab>
                <CollapseInlineButton onClick={() => setLeftCollapsed(true)}>
                  <ChevronLeft size={15} />
                </CollapseInlineButton>
              </PanelTabs>

              {sideTab === 'workers' ? (
                <PanelScroll>
                  <PanelAction>
                    <span>Worker 家族</span>
                    <PanelActionButtons>
                      {selectedFamily && selectedFamily.instances.length === 0 && (
                        <Tooltip title="绑定本机 CLI" mouseEnterDelay={0.5}>
                          <IconButton onClick={() => void bindSelectedFamily()}>
                            <Link size={15} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {mobileInfo?.mobileUrl && (
                        <Tooltip title="复制手机入口" mouseEnterDelay={0.5}>
                          <IconButton onClick={() => void copyMobileUrl()}>
                            <Smartphone size={15} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {workersLoading && <Spin size="small" />}
                    </PanelActionButtons>
                  </PanelAction>
                  {mobileInfo?.mobileUrl && (
                    <MobileAccessBox>
                      <span>手机打开</span>
                      <button onClick={() => void copyMobileUrl()}>
                        <Copy size={13} />
                        <strong>
                          {mobileInfo.lanHost}:{mobileInfo.port}
                        </strong>
                      </button>
                    </MobileAccessBox>
                  )}
                  <WorkerList>
                    <Sortable
                      items={workerListView}
                      itemKey="key"
                      listStyle={{ width: '100%', alignItems: 'stretch' }}
                      itemStyle={{ width: '100%' }}
                      useDragOverlay={false}
                      showGhost={false}
                      onSortEnd={({ oldIndex, newIndex }) => {
                        const nextWorkers = [...workerListView]
                        const [moved] = nextWorkers.splice(oldIndex, 1)
                        nextWorkers.splice(newIndex, 0, moved)
                        void reorderWorkers(nextWorkers)
                      }}
                      renderItem={(worker) => (
                        <WorkerItem
                          key={worker.key}
                          $active={worker.key === selectedFamilyKey}
                          onClick={() => setSelectedFamilyKey(worker.key)}>
                          <WorkerAvatarWrap>
                            <WorkerAvatar src={getAvatarSource(worker.key)} size={32} />
                          </WorkerAvatarWrap>
                          <WorkerMain>
                            <WorkerNameRow>
                              <strong>{worker.label}</strong>
                              <WorkerNameMeta>
                                {workerListView[0]?.key === worker.key && <LeaderChip>主控</LeaderChip>}
                                <WorkerDot $status={worker.status} />
                                <GripVertical size={14} />
                              </WorkerNameMeta>
                            </WorkerNameRow>
                            <span>
                              {worker.healthLabel} · {worker.instances.length} 个实例
                            </span>
                            <small>
                              {worker.workload.label} · {worker.version ?? worker.resolvedCommand ?? worker.engine}
                            </small>
                          </WorkerMain>
                        </WorkerItem>
                      )}
                    />
                  </WorkerList>
                </PanelScroll>
              ) : (
                <PanelScroll>
                  <PanelAction>
                    <span>Session</span>
                    <Tooltip title="新建任务" mouseEnterDelay={0.5}>
                      <IconButton onClick={() => void createTask()}>
                        <Plus size={15} />
                      </IconButton>
                    </Tooltip>
                  </PanelAction>
                  {workspacesLoading || roomsLoading ? (
                    <LoadingBlock>
                      <Spin size="small" />
                    </LoadingBlock>
                  ) : rooms.length === 0 ? (
                    <EmptyBlock>
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有任务" />
                      <Button type="primary" icon={<MessageSquarePlus size={15} />} onClick={() => void createTask()}>
                        新建任务
                      </Button>
                    </EmptyBlock>
                  ) : (
                    <TaskList>
                      {rooms.map((room) => (
                        <TaskItem
                          key={room.id}
                          $active={room.id === selectedRoomId}
                          onClick={() => setSelectedRoomId(room.id)}>
                          <TaskTitleRow>
                            <WorkerAvatar
                              src={getAvatarSource(
                                instanceMap.get(room.assignedAgentId ?? '')?.family ?? selectedFamily?.key
                              )}
                              size={28}
                            />
                            <TaskTitle>{room.title}</TaskTitle>
                          </TaskTitleRow>
                          <TaskMeta>
                            <StatusPill $status={room.status}>{getRoomStatusLabel(room)}</StatusPill>
                            <span>
                              {room.assignedAgentId
                                ? (instanceMap.get(room.assignedAgentId)?.label ?? '已指派')
                                : '未指派'}
                            </span>
                          </TaskMeta>
                        </TaskItem>
                      ))}
                    </TaskList>
                  )}
                </PanelScroll>
              )}
            </>
          )}
        </LeftPanel>

        <MainPane>
          {!selectedRoom ? (
            <EmptyTask>
              <SquareDashed size={32} />
              <h2>选择或创建一个任务</h2>
              <Button type="primary" icon={<Plus size={15} />} onClick={() => void createTask()}>
                新建任务
              </Button>
            </EmptyTask>
          ) : (
            <>
              <TaskHeader>
                <TaskHeaderMain>
                  <TitleLine>
                    {leftCollapsed && (
                      <ShellEdgeButton onClick={() => setLeftCollapsed(false)}>
                        <ChevronRight size={15} />
                      </ShellEdgeButton>
                    )}
                    <h1>{selectedRoom.title}</h1>
                    <StatusPill $status={selectedRoom.status}>{getRoomStatusLabel(selectedRoom)}</StatusPill>
                  </TitleLine>
                  <WorkerSummary>
                    <SummaryItem>
                      <span>当前实例</span>
                      <SummaryIdentity>
                        <WorkerAvatar src={getAvatarSource(activeInstance?.family)} size={24} />
                        <strong>{activeInstance?.label ?? '未指定'}</strong>
                      </SummaryIdentity>
                    </SummaryItem>
                    <SummaryItem>
                      <span>当前模型</span>
                      <Popover
                        open={modelPanelOpen}
                        onOpenChange={setModelPanelOpen}
                        trigger="click"
                        placement="bottomLeft"
                        content={modelStatusPopoverContent}>
                        <ModelButton>
                          <strong>{modelSwitchModel?.name ?? '待选择'}</strong>
                        </ModelButton>
                      </Popover>
                    </SummaryItem>
                    <SummaryItem>
                      <span>当前进度</span>
                      <strong>{runs[0] ? runStatusLabels[runs[0].status] : getRoomStatusLabel(selectedRoom)}</strong>
                    </SummaryItem>
                  </WorkerSummary>
                </TaskHeaderMain>
                <HeaderActions>
                  {selectedInstance && (
                    <Button icon={<RotateCcw size={15} />} onClick={archiveCurrentSession}>
                      新会话
                    </Button>
                  )}
                  {selectedInstance && (
                    <Button
                      icon={<Play size={15} />}
                      disabled={!selectedInstanceCanRun}
                      onClick={() => void assignSelectedInstance()}>
                      {selectedInstanceBusy
                        ? `指派并执行（${selectedInstance.label} 忙碌）`
                        : `指派并执行给 ${selectedInstance.label}`}
                    </Button>
                  )}
                  {activeRun && (
                    <Button danger icon={<Square size={15} />} onClick={() => void stopActiveRun()}>
                      强行停止任务
                    </Button>
                  )}
                </HeaderActions>
              </TaskHeader>

              <Timeline>
                {messagesLoading || runsLoading ? (
                  <LoadingBlock>
                    <Spin size="small" />
                  </LoadingBlock>
                ) : (
                  <>
                    <ProgressStrip>
                      <Popover
                        trigger="click"
                        placement="bottomLeft"
                        content={progressStatusPopoverContent[selectedRoom.assignedAgentId ? 'todo' : 'backlog']}>
                        <ProgressStepButton type="button" $active={selectedRoom.status === 'todo'}>
                          <Circle size={14} />
                          <span>{selectedRoom.assignedAgentId ? '待办' : '待整理'}</span>
                        </ProgressStepButton>
                      </Popover>
                      <Popover trigger="click" placement="bottom" content={progressStatusPopoverContent.in_progress}>
                        <ProgressStepButton type="button" $active={selectedRoom.status === 'in_progress'}>
                          <Loader2 size={14} />
                          <span>进行中</span>
                        </ProgressStepButton>
                      </Popover>
                      <Popover
                        trigger="click"
                        placement="bottom"
                        content={progressStatusPopoverContent.needs_confirmation}>
                        <ProgressStepButton type="button" $active={selectedRoom.status === 'needs_confirmation'}>
                          <Clock3 size={14} />
                          <span>待确认</span>
                        </ProgressStepButton>
                      </Popover>
                      <Popover trigger="click" placement="bottomRight" content={progressStatusPopoverContent.done}>
                        <ProgressStepButton type="button" $active={selectedRoom.status === 'done'}>
                          <CheckCircle2 size={14} />
                          <span>已完成</span>
                        </ProgressStepButton>
                      </Popover>
                    </ProgressStrip>
                    <MessageFeed>
                      {sessionLoading ? (
                        <LoadingBlock>
                          <Spin size="small" />
                        </LoadingBlock>
                      ) : selectedInstance && activeSessionId ? (
                        <AgentSessionMessages agentId={selectedInstance.agent.id} sessionId={activeSessionId} />
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择可用实例开始对话" />
                      )}
                    </MessageFeed>
                  </>
                )}
              </Timeline>

              <Composer>
                {selectedInstance && activeSessionId ? (
                  <AgentSessionInputbar agentId={selectedInstance.agent.id} sessionId={activeSessionId} />
                ) : (
                  <ComposerFallback>先选择可用实例，再开始发送。</ComposerFallback>
                )}
              </Composer>
            </>
          )}
        </MainPane>

        <RightPanel $collapsed={rightCollapsed}>
          {rightCollapsed ? (
            <CollapsedRail $align="start">
              <RailTop>
                <IconButton onClick={() => setRightCollapsed(false)}>
                  <ChevronLeft size={15} />
                </IconButton>
              </RailTop>
            </CollapsedRail>
          ) : !selectedRoom ? (
            <SidebarEmpty>
              <Boxes size={24} />
              <span>选择一个任务后，这里会显示讨论组和 Generic Agent。</span>
            </SidebarEmpty>
          ) : (
            <RightScroll>
              <RightHeaderBar>
                <IconButton onClick={() => setRightCollapsed(true)}>
                  <ChevronRight size={15} />
                </IconButton>
              </RightHeaderBar>
              <SideSection>
                <SectionHeader>
                  <SectionTitle>
                    <Users size={15} />
                    <span>讨论组成员</span>
                  </SectionTitle>
                  {membersLoading && <Spin size="small" />}
                </SectionHeader>
                {roomInstances.length === 0 ? (
                  <SectionHint>还没有把实例拉进这个讨论组。</SectionHint>
                ) : (
                  <MemberList>
                    {roomInstances.map(({ member, instance }) => {
                      const isRouter = autonomyState?.routerAgentId === instance.agent.id
                      const isAssigned = selectedRoom.assignedAgentId === instance.agent.id
                      return (
                        <MemberCard key={member.memberId}>
                          <MemberHead>
                            <MemberIdentity>
                              <WorkerAvatar src={getAvatarSource(instance.family)} size={32} />
                              <div>
                                <strong>{instance.label}</strong>
                                <span>
                                  {instance.family} · {instance.healthLabel}
                                </span>
                              </div>
                            </MemberIdentity>
                            <div>
                              {isRouter && (
                                <RoleBadge>
                                  <Crown size={11} />
                                  队长
                                </RoleBadge>
                              )}
                              {isAssigned && <RoleBadge>负责人</RoleBadge>}
                            </div>
                          </MemberHead>
                          <MemberActions>
                            {!isRouter && (
                              <MiniButton onClick={() => void setRoomRouter(instance)}>设为队长</MiniButton>
                            )}
                            <MiniButton onClick={() => void removeMemberFromRoom(member)}>移出讨论组</MiniButton>
                          </MemberActions>
                        </MemberCard>
                      )
                    })}
                  </MemberList>
                )}
              </SideSection>

              <SideSection>
                <SectionHeader>
                  <SectionTitle>
                    <Activity size={15} />
                    <span>Generic Agent</span>
                  </SectionTitle>
                  {autonomyLoading && <Spin size="small" />}
                </SectionHeader>
                <ControlRow>
                  <span>允许自主行动</span>
                  <Switch
                    checked={autonomyState?.enabled ?? false}
                    onChange={(checked) => void toggleAutonomy(checked)}
                  />
                </ControlRow>
                <AutonomyButtons>
                  <Button icon={<Play size={15} />} onClick={() => void runAutonomyNow()}>
                    开始空闲自主行动
                  </Button>
                  <Button danger icon={<Square size={15} />} onClick={() => void stopAutonomy()}>
                    停止自主行动
                  </Button>
                </AutonomyButtons>
                <StatusBoard>
                  <StatusLine>
                    <span>当前状态</span>
                    <strong>{autonomyState ? autonomyStatusLabels[autonomyState.status] : '读取中'}</strong>
                  </StatusLine>
                  <StatusLine>
                    <span>触发倒计时</span>
                    <strong>{formatCountdown(autonomyState?.remainingMs)}</strong>
                  </StatusLine>
                  <StatusLine>
                    <span>队长实例</span>
                    <strong>
                      {autonomyState?.routerAgentId
                        ? (instanceMap.get(autonomyState.routerAgentId)?.label ?? '已设定')
                        : '未指定'}
                    </strong>
                  </StatusLine>
                </StatusBoard>
                {autonomyState?.lastResult && <AutonomyResult>{autonomyState.lastResult.summary}</AutonomyResult>}
              </SideSection>

              <SideSection>
                <SectionHeader>
                  <SectionTitle>
                    <Link size={15} />
                    <span>应用与 MCP</span>
                  </SectionTitle>
                  <MiniButton onClick={() => window.navigate('/settings/mcp/builtin')}>添加</MiniButton>
                </SectionHeader>
                <QuickMcpGrid>
                  {quickMcpStatuses.map((app) => {
                    const Icon = app.icon
                    return (
                      <QuickMcpCard key={app.name} onClick={() => window.navigate('/settings/mcp/builtin')}>
                        <QuickMcpIcon>
                          <Icon size={15} />
                        </QuickMcpIcon>
                        <QuickMcpInfo>
                          <strong>{app.label}</strong>
                          <span>{app.description}</span>
                        </QuickMcpInfo>
                        <QuickMcpStatus $active={app.active}>{app.active ? '已启用' : '去连接'}</QuickMcpStatus>
                      </QuickMcpCard>
                    )
                  })}
                </QuickMcpGrid>
              </SideSection>

              <SideSection>
                <SectionHeader>
                  <SectionTitle>
                    <Bot size={15} />
                    <span>实例运行</span>
                  </SectionTitle>
                  <PanelActionButtons>
                    {selectedFamily && selectedFamily.instances.length === 0 && (
                      <Tooltip title="绑定 Worker">
                        <IconButton onClick={() => void bindSelectedFamily()}>
                          <Link size={15} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {selectedFamily && (
                      <Tooltip title="新建长期分身">
                        <IconButton onClick={() => void createSelectedInstance()}>
                          <Plus size={15} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </PanelActionButtons>
                </SectionHeader>
                {!selectedFamily ? (
                  <SectionHint>先在左侧选一个 Worker 家族。</SectionHint>
                ) : selectedFamily.instances.length === 0 ? (
                  <SectionHint>
                    {selectedFamily.canRun
                      ? `${selectedFamily.label} 已检测到本机命令，首次派活会自动创建实例，也可以先手动绑定或创建。`
                      : `${selectedFamily.label} 还没有真实实例，先绑定或创建。`}
                  </SectionHint>
                ) : (
                  <InstanceList>
                    {selectedFamily.instances.map((instance) => {
                      const inRoom = roomInstances.some((entry) => entry.instance.agent.id === instance.agent.id)
                      const isRouter = autonomyState?.routerAgentId === instance.agent.id
                      return (
                        <InstanceCard
                          key={instance.agent.id}
                          $active={selectedInstance?.agent.id === instance.agent.id}
                          onClick={() => setSelectedInstanceId(instance.agent.id)}>
                          <InstanceHead>
                            <MemberIdentity>
                              <WorkerAvatar src={getAvatarSource(instance.family)} size={32} />
                              <div>
                                <strong>{instance.label}</strong>
                                <span>
                                  {instance.healthLabel} · {instance.workload.label}
                                </span>
                              </div>
                            </MemberIdentity>
                            <WorkerDot $status={instance.status} />
                          </InstanceHead>
                          <InstanceMeta>
                            <Tag>
                              {instance.role === 'primary' ? '主实例' : instance.role === 'router' ? '路由' : '分身'}
                            </Tag>
                            {isRouter && <Tag color="gold">讨论组队长</Tag>}
                          </InstanceMeta>
                          <InstanceModelButton
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              void updateInstanceModel(instance)
                            }}>
                            模型：{getCurrentInstanceModel(instance)?.name ?? '待选择'} ·{' '}
                            {getModelSourceLabel(instance)}
                          </InstanceModelButton>
                          <Segmented
                            size="small"
                            options={styleModeOptions}
                            value={instance.styleMode}
                            onChange={(value) => void updateInstanceStyle(instance, value)}
                          />
                          <InstanceActions>
                            {inRoom ? (
                              <MiniButton
                                onClick={() =>
                                  void removeMemberFromRoom(
                                    roomInstances.find((entry) => entry.instance.agent.id === instance.agent.id)!.member
                                  )
                                }>
                                移出讨论组
                              </MiniButton>
                            ) : (
                              <MiniButton onClick={() => void addInstanceToRoom(instance)}>
                                <UserPlus size={13} />
                                加入讨论组
                              </MiniButton>
                            )}
                            {!isRouter && (
                              <MiniButton onClick={() => void setRoomRouter(instance)}>设为队长</MiniButton>
                            )}
                          </InstanceActions>
                        </InstanceCard>
                      )
                    })}
                  </InstanceList>
                )}
              </SideSection>
            </RightScroll>
          )}
        </RightPanel>
      </TaskShell>
    </QuickPanelProvider>
  )
}

const FeedMessage = ({
  message,
  instances,
  collapsed,
  forceExpanded,
  contentOverride,
  onToggleCollapse
}: {
  message: CollaborationRoomMessage
  instances: Map<string, WorkerInstance>
  collapsed: boolean
  forceExpanded?: boolean
  contentOverride?: ReactNode
  onToggleCollapse: () => void
}) => {
  const worker = message.authorId ? instances.get(message.authorId) : undefined
  const name =
    message.authorType === 'system' ? '系统' : (worker?.label ?? (message.authorType === 'user' ? '你' : 'Worker'))
  const attachments = readMessageAttachments(message)
  const hasStderr = readHasStderr(message)
  const canCollapse = !contentOverride && shouldCollapseMessage(message)
  const isCollapsed = canCollapse && collapsed && !forceExpanded
  const previewContent = message.content.length > 600 ? `${message.content.slice(0, 600)}...` : message.content

  return (
    <FeedItem $kind={message.kind} $stderr={hasStderr}>
      <FeedMeta>
        <FeedIdentity>
          <WorkerAvatar src={getAvatarSource(worker?.family)} size={28} />
          <strong>{name}</strong>
        </FeedIdentity>
        {hasStderr && <FeedFlag>stderr</FeedFlag>}
        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
      </FeedMeta>
      {contentOverride ? (
        <FeedEmbeddedContent>{contentOverride}</FeedEmbeddedContent>
      ) : (
        <FeedContent $stderr={hasStderr} $collapsed={isCollapsed}>
          {isCollapsed ? previewContent : message.content}
        </FeedContent>
      )}
      {canCollapse && !forceExpanded && (
        <FeedCollapseButton type="text" onClick={onToggleCollapse}>
          {isCollapsed ? '展开' : '收起'}
        </FeedCollapseButton>
      )}
      {attachments.length > 0 && (
        <FeedAttachments>
          {attachments.map((file) => (
            <FeedAttachmentTag key={`${message.id}:${file.path}`} icon={getFileIcon(file.ext)}>
              <FileNameRender file={file} />
            </FeedAttachmentTag>
          ))}
        </FeedAttachments>
      )}
    </FeedItem>
  )
}

const TaskShell = styled.div<{ $leftCollapsed: boolean; $rightCollapsed: boolean }>`
  display: grid;
  grid-template-columns: ${({ $leftCollapsed, $rightCollapsed }) =>
    `${$leftCollapsed ? '56px' : 'var(--assistants-width)'} minmax(0, 1fr) ${$rightCollapsed ? '52px' : '324px'}`};
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  margin-right: 6px;
  margin-bottom: 6px;
  border-radius: 10px;
  background: var(--color-background);
`

const LeftPanel = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 0.5px solid var(--color-border);
  background: color-mix(in srgb, var(--color-background) 92%, var(--color-background-soft));
`

const PanelTabs = styled.div`
  display: flex;
  align-items: center;
  margin: 0 12px;
  padding: 2px 0 6px;
  border-bottom: 1px solid var(--color-border);
  -webkit-app-region: no-drag;
`

const PanelTab = styled.button<{ $active: boolean }>`
  position: relative;
  flex: 1;
  height: 30px;
  border: none;
  background: transparent;
  color: ${({ $active }) => ($active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  cursor: pointer;

  &::after {
    position: absolute;
    bottom: -7px;
    left: 50%;
    width: ${({ $active }) => ($active ? '30px' : '0')};
    height: 3px;
    border-radius: 1px;
    background: var(--color-primary);
    content: '';
    transform: translateX(-50%);
    transition: width 0.2s ease;
  }
`

const PanelScroll = styled(Scrollbar)`
  flex: 1;
  min-height: 0;
  padding: 12px 10px;
`

const PanelAction = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 600;
`

const PanelActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const IconButton = styled.button`
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text-2);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    background: var(--color-list-item-hover);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`

const CollapseInlineButton = styled(IconButton)`
  margin-left: auto;
`

const CollapsedRail = styled.div<{ $align?: 'center' | 'start' }>`
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: ${({ $align }) => ($align === 'start' ? 'flex-start' : 'space-between')};
  padding: 10px 8px;
`

const RailTop = styled.div`
  display: flex;
  width: 100%;
  justify-content: center;
`

const RailTabs = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: flex-start;
  margin-top: 12px;
`

const RailTabButton = styled.button<{ $active: boolean }>`
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 10px;
  background: ${({ $active }) => ($active ? 'var(--color-list-item)' : 'transparent')};
  color: ${({ $active }) => ($active ? 'var(--color-text)' : 'var(--color-text-2)')};
  cursor: pointer;
`

const MobileAccessBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 12px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  padding: 9px 10px;

  > span {
    color: var(--color-text-3);
    font-size: 12px;
  }

  button {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  strong {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const WorkerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const WorkerItem = styled.button<{ $active: boolean }>`
  display: flex;
  width: 100%;
  min-height: 56px;
  align-items: center;
  gap: 10px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  border-radius: var(--list-item-border-radius);
  background: ${({ $active }) => ($active ? 'var(--color-list-item)' : 'transparent')};
  color: var(--color-text);
  cursor: grab;
  padding: 8px 9px;
  text-align: left;

  &:hover {
    background: var(--color-list-item-hover);
  }

  &:active {
    cursor: grabbing;
  }
`

const WorkerAvatarWrap = styled.div`
  display: flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
`

const WorkerAvatar = styled(Avatar)`
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
`

const WorkerMain = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;

  span,
  small {
    overflow: hidden;
    color: var(--color-text-3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    font-size: 12px;
  }

  small {
    font-size: 11px;
  }
`

const WorkerNameRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
`

const WorkerNameMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-3);
`

const LeaderChip = styled.span`
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  font-size: 11px;
  padding: 2px 8px;
`

const WorkerDot = styled.span<{ $status: string }>`
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: ${({ $status }) =>
    $status === 'online'
      ? 'var(--color-primary)'
      : $status === 'running'
        ? 'var(--color-warning)'
        : 'var(--color-border)'};
`

const TaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TaskItem = styled.button<{ $active: boolean }>`
  width: 100%;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  border-radius: var(--list-item-border-radius);
  background: ${({ $active }) => ($active ? 'var(--color-list-item)' : 'transparent')};
  color: var(--color-text);
  cursor: pointer;
  padding: 10px;
  text-align: left;

  &:hover {
    background: var(--color-list-item-hover);
  }
`

const TaskTitle = styled.div`
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TaskTitleRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
`

const TaskMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--color-text-3);
  font-size: 12px;
`

const StatusPill = styled.span<{ $status: CollaborationRoom['status'] }>`
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  border-radius: 999px;
  background: ${({ $status }) =>
    $status === 'blocked'
      ? 'color-mix(in srgb, var(--color-error) 14%, transparent)'
      : $status === 'done'
        ? 'color-mix(in srgb, var(--color-primary) 14%, transparent)'
        : 'var(--color-background-soft)'};
  color: ${({ $status }) => ($status === 'blocked' ? 'var(--color-error)' : 'var(--color-text-2)')};
  font-size: 12px;
  padding: 2px 8px;
  white-space: nowrap;
`

const MainPane = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const TaskHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 0.5px solid var(--color-border);
  padding: 18px 22px 14px;
`

const TaskHeaderMain = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
`

const ModelButton = styled(Button)`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  border: 0.5px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  height: auto;
  padding: 4px 10px;
  cursor: pointer;

  &:hover {
    border-color: var(--color-primary) !important;
    background: color-mix(in srgb, var(--color-primary) 20%, transparent);
    color: var(--color-primary) !important;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }

  small {
    color: var(--color-text-3);
    font-size: 11px;
    font-weight: 500;
  }
`

const ModelStatusPopover = styled.div`
  display: flex;
  width: 420px;
  flex-direction: column;
  gap: 14px;
`

const ModelStatusSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ModelStatusHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  strong {
    display: block;
    color: var(--color-text-1);
    font-size: 13px;
  }

  span {
    display: block;
    margin-top: 4px;
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const ModelStatusTitle = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 600;
`

const ModelStatusMetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
`

const ModelStatusMetric = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;

  label {
    color: var(--color-text-3);
    font-size: 11px;
  }

  strong {
    overflow: hidden;
    color: var(--color-text-1);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const ModelStatusCountGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
`

const ModelStatusCountCard = styled.div`
  display: flex;
  min-height: 58px;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  padding: 8px 10px;

  span {
    color: var(--color-text-3);
    font-size: 11px;
  }

  strong {
    color: var(--color-text-1);
    font-size: 16px;
  }
`

const ModelTodoList = styled.div`
  display: flex;
  max-height: 250px;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
`

const ModelTodoItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 10px;
  background: ${({ $active }) => ($active ? 'var(--color-list-item)' : 'var(--color-background-soft)')};
  color: var(--color-text);
  cursor: pointer;
  padding: 10px;
  text-align: left;

  &:hover {
    background: var(--color-list-item-hover);
  }
`

const ModelTodoMain = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;

  strong {
    overflow: hidden;
    color: var(--color-text-1);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--color-text-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const ModelTodoRunning = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  flex-shrink: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
  color: var(--color-warning);
  font-size: 11px;
  padding: 0 8px;
`

const ModelStatusEmpty = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
`

const TitleLine = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;

  h1 {
    overflow: hidden;
    margin: 0;
    color: var(--color-text);
    font-size: 18px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const WorkerSummary = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
`

const SummaryItem = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;

  span {
    color: var(--color-text-3);
    font-size: 12px;
  }

  strong {
    overflow: hidden;
    color: var(--color-text-1);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const SummaryIdentity = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;

  strong {
    min-width: 0;
  }
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
`

const ShellEdgeButton = styled(IconButton)`
  flex-shrink: 0;
`

const Timeline = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 18px 22px 12px;
  overflow: hidden;
`

const ProgressStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 18px;
`

const ProgressStepButton = styled.button<{ $active: boolean }>`
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 8px;
  background: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'transparent')};
  color: ${({ $active }) => ($active ? 'var(--color-text)' : 'var(--color-text-3)')};
  font-size: 13px;
  cursor: pointer;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-text);
  }
`

const StatusPopover = styled.div`
  display: flex;
  width: 360px;
  max-width: 40vw;
  flex-direction: column;
  gap: 12px;
`

const StatusPopoverHeader = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;

  strong {
    display: block;
    color: var(--color-text);
    font-size: 14px;
  }

  span {
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const StatusMetricRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
`

const StatusMetricCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  padding: 8px;

  label {
    color: var(--color-text-3);
    font-size: 11px;
  }

  strong {
    color: var(--color-text);
    font-size: 13px;
  }
`

const StatusWorkersList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const StatusWorkerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  strong {
    display: block;
    color: var(--color-text);
    font-size: 12px;
  }

  span {
    color: var(--color-text-3);
    font-size: 11px;
  }
`

const StatusRoomsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const StatusRoomRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  padding: 8px 10px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex-shrink: 0;
    color: var(--color-text-3);
    font-size: 11px;
  }
`

const StatusEmpty = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
`

const MessageFeed = styled.div`
  display: flex;
  max-width: 860px;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
`

const FeedItem = styled.div<{ $kind: CollaborationRoomMessage['kind']; $stderr?: boolean }>`
  border-left: 3px solid
    ${({ $kind, $stderr }) =>
      $stderr ? 'var(--color-error)' : $kind === 'task' ? 'var(--color-primary)' : 'var(--color-border)'};
  border-radius: 8px;
  background: ${({ $stderr }) =>
    $stderr
      ? 'color-mix(in srgb, var(--color-error) 8%, var(--color-background-soft))'
      : 'var(--color-background-soft)'};
  padding: 11px 13px;
`

const FeedMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;

  strong {
    color: var(--color-text);
    font-size: 13px;
  }

  span {
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const FeedIdentity = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
`

const FeedFlag = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-error) 18%, transparent);
  color: var(--color-error);
  font-size: 11px;
  line-height: 1;
  padding: 2px 7px;
`

const FeedContent = styled.div<{ $stderr?: boolean; $collapsed?: boolean }>`
  color: ${({ $stderr }) => ($stderr ? 'var(--color-error)' : 'var(--color-text-1)')};
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  max-height: ${({ $collapsed }) => ($collapsed ? '5.5em' : 'none')};
  overflow: ${({ $collapsed }) => ($collapsed ? 'hidden' : 'visible')};
`

const FeedEmbeddedContent = styled.div`
  margin-top: 2px;
`

const FeedCollapseButton = styled(Button)`
  margin-top: 4px;
  padding: 0;
  height: auto;
  color: var(--color-text-2);
  font-size: 12px;
`

const FeedAttachments = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
`

const FeedAttachmentTag = styled(Tag)`
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
`

const Composer = styled.div`
  margin: 0 22px 18px;
  border: 0.5px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  padding: 10px;
  flex-shrink: 0;

  textarea.ant-input {
    border: none;
    box-shadow: none;
    resize: none;
    background: transparent;
    color: var(--color-text);
  }
`

const ComposerFallback = styled.div`
  border: 0.5px dashed var(--color-border);
  border-radius: 10px;
  padding: 12px;
  color: var(--color-text-3);
  font-size: 13px;
`

const ComposerToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`

const ToolbarPrimary = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ToolbarMeta = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
`

const ToolbarChipButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 999px;
  background: ${({ $active }) => ($active ? 'var(--color-list-item)' : 'var(--color-background-soft)')};
  color: ${({ $active }) => ($active ? 'var(--color-text)' : 'var(--color-text-2)')};
  font-size: 12px;
  padding: 0 10px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-text);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
`

const ToolbarCollapseButton = styled(IconButton)`
  margin-left: auto;
`

const ComposerFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
`

const ComposerMeta = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
`

const ComposerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
`

void FeedMessage
void ComposerToolbar
void ToolbarPrimary
void ToolbarMeta
void ToolbarChipButton
void ToolbarCollapseButton
void ComposerFooter
void ComposerMeta
void ComposerActions

const RightPanel = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 0.5px solid var(--color-border);
  background: color-mix(in srgb, var(--color-background) 94%, var(--color-background-soft));
  overflow: hidden;
`

const RightScroll = styled(Scrollbar)`
  flex: 1;
  min-height: 0;
  padding: 14px 12px;
`

const RightHeaderBar = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
`

const SideSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  padding: 12px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
`

const SectionHint = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 1.5;
`

const QuickMcpGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const QuickMcpCard = styled.button`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  cursor: pointer;
  padding: 9px;
  text-align: left;

  &:hover {
    border-color: var(--color-primary);
    background: var(--color-list-item-hover);
  }
`

const QuickMcpIcon = styled.div`
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
`

const QuickMcpInfo = styled.div`
  min-width: 0;

  strong,
  span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
  }

  span {
    color: var(--color-text-3);
    font-size: 11px;
  }
`

const QuickMcpStatus = styled.span<{ $active: boolean }>`
  border-radius: 999px;
  background: ${({ $active }) =>
    $active
      ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)'
      : 'color-mix(in srgb, var(--color-warning) 12%, transparent)'};
  color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-warning)')};
  font-size: 11px;
  padding: 2px 7px;
  white-space: nowrap;
`

const MemberList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const MemberCard = styled.div`
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  padding: 10px;
`

const MemberHead = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 10px;

  strong {
    display: block;
    color: var(--color-text);
    font-size: 13px;
  }

  span {
    display: block;
    margin-top: 4px;
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const MemberIdentity = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
`

const MemberActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
`

const RoleBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-text);
  font-size: 11px;
  padding: 3px 8px;
`

const ControlRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-text-2);
  font-size: 13px;
`

const AutonomyButtons = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const StatusBoard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 8px;
  background: var(--color-background);
  padding: 10px;
`

const StatusLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  span {
    color: var(--color-text-3);
    font-size: 12px;
  }

  strong {
    color: var(--color-text);
    font-size: 12px;
  }
`

const AutonomyResult = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  line-height: 1.5;
`

const InstanceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const InstanceCard = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 10px;
  background: ${({ $active }) => ($active ? 'var(--color-list-item)' : 'var(--color-background)')};
  color: var(--color-text);
  cursor: pointer;
  padding: 10px;
  text-align: left;
`

const InstanceHead = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 10px;

  strong {
    display: block;
    color: var(--color-text);
    font-size: 13px;
  }

  span {
    display: block;
    margin-top: 4px;
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const InstanceMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const InstanceModelButton = styled.button`
  width: 100%;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-2);
  cursor: pointer;
  font-size: 12px;
  padding: 7px 9px;
  text-align: left;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
`

const InstanceActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const MiniButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-2);
  cursor: pointer;
  font-size: 12px;
  padding: 6px 8px;
`

const ServerGate = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-2);

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: 18px;
  }

  p {
    max-width: 420px;
    margin: 0;
    text-align: center;
    font-size: 13px;
  }
`

const LoadingBlock = styled.div`
  display: flex;
  justify-content: center;
  padding: 20px 0;
`

const EmptyBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const EmptyTask = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--color-text-3);

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: 18px;
  }
`

const SidebarEmpty = styled.div`
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-3);
  padding: 18px;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
`

export default WorkerTaskHome

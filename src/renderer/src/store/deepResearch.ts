import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { Assistant, KnowledgeReference, MCPToolResponse, Message, WebSearchResponse } from '@types'

// --- State & Type Definitions ---

export interface DeepResearchConfig {
  maxResearchDepth: number
  maxParallelResearchTasks: number
}

type ResearchTaskInfoSource = WebSearchResponse | KnowledgeReference | MCPToolResponse

// 反映研究员子任务的状态
export interface ResearcherTask {
  id: string
  topic: string
  status: 'pending' | 'running' | 'compressing' | 'completed' | 'failed'
  rawResult?: string
  infoSources: ResearchTaskInfoSource[]
  compressedResult?: string
  error?: string
}

// 单个 Deep Research 任务的完整状态
export interface DeepResearchState {
  id: string // 与TopicId相同
  assistant: Assistant
  config: DeepResearchConfig

  status:
    | 'idle'
    | 'clarifying'
    | 'briefing'
    | 'supervising'
    | 'researching'
    | 'generatingReport'
    | 'succeeded'
    | 'failed'
    | 'aborted'
  error?: string

  messages: Message['id'][]

  researchBrief: string

  supervisor: {
    iterations: number
    messages: string[] // 可以用来存储 supervisor 的 "思考" 过程
  }

  researcherTasks: { [id: string]: ResearcherTask }
}

export interface DeepResearchSliceState {
  researches: { [id: string]: DeepResearchState }
}

const initialState: DeepResearchSliceState = {
  researches: {}
}

export type StartResearchPayload = {
  researchId: string
  initialMessage: string
  assistant: Assistant
  config: DeepResearchConfig
}

export const deepResearchSlice = createSlice({
  name: 'deepResearch',
  initialState,
  reducers: {
    // 1. 开始一个新的研究任务
    startResearch: (state, action: PayloadAction<StartResearchPayload>) => {
      const { researchId, initialMessage, assistant, config } = action.payload
      state.researches[researchId] = {
        id: researchId,
        config,
        assistant,
        status: 'clarifying', // 流程从 "澄清" 开始
        messages: [initialMessage],
        researchBrief: '',
        supervisor: { iterations: 0, messages: [] },
        researcherTasks: {}
      }
    },

    // 2. 更新任务的整体状态和消息
    updateStatus: (state, action: PayloadAction<{ researchId: string; status: DeepResearchState['status'] }>) => {
      const { researchId, status } = action.payload
      if (state.researches[researchId]) {
        state.researches[researchId].status = status
      }
    },
    addMessage: (state, action: PayloadAction<{ researchId: string; message: string }>) => {
      const { researchId, message } = action.payload
      if (state.researches[researchId]) {
        state.researches[researchId].messages.push(message)
      }
    },

    // 3. 设置研究简报
    setResearchBrief: (state, action: PayloadAction<{ researchId: string; brief: string }>) => {
      const { researchId, brief } = action.payload
      if (state.researches[researchId]) {
        state.researches[researchId].researchBrief = brief
        state.researches[researchId].status = 'supervising' // 进入 "监督" 阶段
      }
    },

    incrementSupervisorIterations: (state, action: PayloadAction<{ researchId: string }>) => {
      const { researchId } = action.payload
      if (state.researches[researchId]) {
        state.researches[researchId].supervisor.iterations += 1
      }
    },

    // 4. 添加研究员任务
    addResearcherTasks: (state, action: PayloadAction<{ researchId: string; tasks: ResearcherTask[] }>) => {
      const { researchId, tasks } = action.payload
      if (state.researches[researchId]) {
        tasks.forEach((task) => {
          state.researches[researchId].researcherTasks[task.id] = task
        })
      }
    },

    // 5. 更新单个研究员任务的状态
    updateResearcherTask: (
      state,
      action: PayloadAction<{ researchId: string; taskId: string; updates: Partial<ResearcherTask> }>
    ) => {
      const { researchId, taskId, updates } = action.payload
      const research = state.researches[researchId]
      if (research) {
        const task = research.researcherTasks[taskId]
        if (task) {
          Object.assign(task, updates)
        }
      }
    },

    updateResearcherTaskInfoSources: (
      state,
      action: PayloadAction<{ researchId: string; taskId: string; infoSource: ResearchTaskInfoSource }>
    ) => {
      const { researchId, taskId, infoSource } = action.payload
      const research = state.researches[researchId]
      if (!research) return
      const task = research.researcherTasks[taskId]
      if (!task) return
      task.infoSources.push(infoSource)
    },

    // 7. 设置错误
    setResearchError: (state, action: PayloadAction<{ researchId: string; error: string }>) => {
      const { researchId, error } = action.payload
      if (state.researches[researchId]) {
        state.researches[researchId].status = 'failed'
        state.researches[researchId].error = error
      }
    },

    // 清理研究相关的资源，只保留id和状态
    cleanupResearch: (state, action: PayloadAction<{ researchId: string }>) => {
      const { researchId } = action.payload
      const research = state.researches[researchId]
      if (!research) return
      state.researches[researchId] = {
        ...research,
        messages: [],
        researchBrief: '',
        supervisor: { iterations: 0, messages: [] },
        researcherTasks: {}
      }
    }
  }
})

export const deepResearchActions = deepResearchSlice.actions

export default deepResearchSlice.reducer

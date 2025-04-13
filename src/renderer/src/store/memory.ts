import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { nanoid } from 'nanoid'
import log from 'electron-log'

// 记忆列表接口
export interface MemoryList {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  isActive: boolean // 是否在对话中使用该记忆列表
}

// 记忆项接口
export interface Memory {
  id: string
  content: string
  createdAt: string
  source?: string // 来源，例如"自动分析"或"手动添加"
  category?: string // 分类，例如"用户偏好"、"技术需求"等
  listId: string // 所属的记忆列表ID
  analyzedMessageIds?: string[] // 记录该记忆是从哪些消息中分析出来的
  lastMessageId?: string // 分析时的最后一条消息的ID，用于跟踪分析进度
  topicId?: string // 关联的对话话题ID，用于跟踪该记忆来自哪个话题
  vector?: number[] // 记忆的向量表示，用于语义搜索
  entities?: string[] // 记忆中提取的实体
  keywords?: string[] // 记忆中提取的关键词
  importance?: number // 记忆的重要性评分（0-1）
  accessCount?: number // 记忆被访问的次数
  lastAccessedAt?: string // 记忆最后被访问的时间
  decayFactor?: number // 记忆衰减因子（0-1），值越小衰减越大
  freshness?: number // 记忆鲜度评分（0-1），基于创建时间和最后访问时间
}

// 短记忆项接口
export interface ShortMemory {
  id: string
  content: string
  createdAt: string
  topicId: string // 关联的对话话题ID
  analyzedMessageIds?: string[] // 记录该记忆是从哪些消息中分析出来的
  lastMessageId?: string // 分析时的最后一条消息的ID，用于跟踪分析进度
  vector?: number[] // 记忆的向量表示，用于语义搜索
  entities?: string[] // 记忆中提取的实体
  keywords?: string[] // 记忆中提取的关键词
  importance?: number // 记忆的重要性评分（0-1）
  accessCount?: number // 记忆被访问的次数
  lastAccessedAt?: string // 记忆最后被访问的时间
  decayFactor?: number // 记忆衰减因子（0-1），值越小衰减越快
  freshness?: number // 记忆鲜度评分（0-1），基于创建时间和最后访问时间
}

// 分析统计数据接口
export interface AnalysisStats {
  totalAnalyses: number // 总分析次数
  successfulAnalyses: number // 成功分析次数（生成了新记忆）
  newMemoriesGenerated: number // 生成的新记忆数量
  averageAnalysisTime: number // 平均分析时间（毫秒）
  lastAnalysisTime: number // 上次分析时间戳
}

// 性能指标接口
export interface PerformanceMetrics {
  analysisLatency: number[] // 最近的分析延迟时间（毫秒）
  memoryRetrievalLatency: number[] // 最近的记忆检索延迟时间（毫秒）
  memoryCount: number // 当前记忆数量
  shortMemoryCount: number // 当前短期记忆数量
  lastPerformanceCheck: number // 上次性能检查时间
}

// 用户关注点接口
export interface UserInterest {
  topic: string // 关注主题
  weight: number // 权重（0-1）
  lastUpdated: string // 上次更新时间
}

export interface MemoryState {
  memoryLists: MemoryList[] // 记忆列表
  memories: Memory[] // 所有记忆项
  shortMemories: ShortMemory[] // 短记忆项
  currentListId: string | null // 当前选中的记忆列表ID
  isActive: boolean // 记忆功能是否激活
  shortMemoryActive: boolean // 短记忆功能是否激活
  autoAnalyze: boolean // 是否自动分析
  analyzeModel: string | null // 用于长期记忆分析的模型ID
  shortMemoryAnalyzeModel: string | null // 用于短期记忆分析的模型ID
  vectorizeModel: string | null // 用于向量化的模型ID
  lastAnalyzeTime: number | null // 上次分析时间
  isAnalyzing: boolean // 是否正在分析

  // 自适应分析相关
  adaptiveAnalysisEnabled: boolean // 是否启用自适应分析
  analysisFrequency: number // 分析频率（消息数）
  analysisDepth: 'low' | 'medium' | 'high' // 分析深度
  analysisStats: AnalysisStats // 分析统计数据

  // 用户关注点相关
  interestTrackingEnabled: boolean // 是否启用兴趣跟踪
  userInterests: UserInterest[] // 用户关注点

  // 性能监控相关
  monitoringEnabled: boolean // 是否启用性能监控
  performanceMetrics: PerformanceMetrics // 性能指标

  // 智能优先级与时效性管理相关
  priorityManagementEnabled: boolean // 是否启用智能优先级管理
  decayEnabled: boolean // 是否启用记忆衰减功能
  freshnessEnabled: boolean // 是否启用记忆鲜度评估
  decayRate: number // 记忆衰减速率（0-1）
  lastPriorityUpdate: number // 上次优先级更新时间
}

// 创建默认记忆列表
const defaultList: MemoryList = {
  id: nanoid(),
  name: '默认记忆',
  description: '系统默认的记忆列表',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isActive: true
}

const initialState: MemoryState = {
  memoryLists: [defaultList],
  memories: [],
  shortMemories: [], // 初始化空的短记忆数组
  currentListId: defaultList.id,
  isActive: true,
  shortMemoryActive: true, // 默认启用短记忆功能
  autoAnalyze: true,
  analyzeModel: 'gpt-3.5-turbo', // 设置默认长期记忆分析模型
  shortMemoryAnalyzeModel: 'gpt-3.5-turbo', // 设置默认短期记忆分析模型
  vectorizeModel: 'gpt-3.5-turbo', // 设置默认向量化模型
  lastAnalyzeTime: null,
  isAnalyzing: false,

  // 自适应分析相关
  adaptiveAnalysisEnabled: true, // 默认启用自适应分析
  analysisFrequency: 5, // 默认每5条消息分析一次
  analysisDepth: 'medium', // 默认分析深度
  analysisStats: {
    totalAnalyses: 0,
    successfulAnalyses: 0,
    newMemoriesGenerated: 0,
    averageAnalysisTime: 0,
    lastAnalysisTime: 0
  },

  // 用户关注点相关
  interestTrackingEnabled: true, // 默认启用兴趣跟踪
  userInterests: [],

  // 性能监控相关
  monitoringEnabled: true, // 默认启用性能监控
  performanceMetrics: {
    analysisLatency: [],
    memoryRetrievalLatency: [],
    memoryCount: 0,
    shortMemoryCount: 0,
    lastPerformanceCheck: Date.now()
  },

  // 智能优先级与时效性管理相关
  priorityManagementEnabled: true, // 默认启用智能优先级管理
  decayEnabled: true, // 默认启用记忆衰减功能
  freshnessEnabled: true, // 默认启用记忆鲜度评估
  decayRate: 0.05, // 默认衰减速率，每天减少5%
  lastPriorityUpdate: Date.now() // 初始化为当前时间
}

const memorySlice = createSlice({
  name: 'memory',
  initialState,
  reducers: {
    // 添加新记忆
    addMemory: (
      state,
      action: PayloadAction<{
        content: string
        source?: string
        category?: string
        listId?: string
        analyzedMessageIds?: string[]
        lastMessageId?: string
        topicId?: string
      }>
    ) => {
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = [defaultList]
      }

      // 使用指定的列表ID或当前选中的列表ID
      const listId =
        action.payload.listId ||
        state.currentListId ||
        (state.memoryLists.length > 0 ? state.memoryLists[0].id : defaultList.id)

      const newMemory: Memory = {
        id: nanoid(),
        content: action.payload.content,
        createdAt: new Date().toISOString(),
        source: action.payload.source || '手动添加',
        category: action.payload.category,
        listId: listId,
        analyzedMessageIds: action.payload.analyzedMessageIds,
        lastMessageId: action.payload.lastMessageId,
        topicId: action.payload.topicId
      }

      // 确保 memories 存在
      if (!state.memories) {
        state.memories = []
      }
      state.memories.push(newMemory)

      // 更新记忆列表的更新时间
      const list = state.memoryLists.find((list) => list.id === listId)
      if (list) {
        list.updatedAt = new Date().toISOString()
      }
    },

    // 删除记忆
    deleteMemory: (state, action: PayloadAction<string>) => {
      // 确保 memories 存在
      if (!state.memories) {
        state.memories = []
        return
      }
      state.memories = state.memories.filter((memory) => memory.id !== action.payload)
    },

    // 编辑记忆
    editMemory: (state, action: PayloadAction<{ id: string; content: string }>) => {
      // 确保 memories 存在
      if (!state.memories) {
        state.memories = []
        return
      }

      const memory = state.memories.find((m) => m.id === action.payload.id)
      if (memory) {
        memory.content = action.payload.content
      }
    },

    // 设置记忆功能是否激活
    setMemoryActive: (state, action: PayloadAction<boolean>) => {
      state.isActive = action.payload
    },

    // 设置是否自动分析
    setAutoAnalyze: (state, action: PayloadAction<boolean>) => {
      state.autoAnalyze = action.payload
    },

    // 设置长期记忆分析模型
    setAnalyzeModel: (state, action: PayloadAction<string | null>) => {
      state.analyzeModel = action.payload
    },

    // 设置短期记忆分析模型
    setShortMemoryAnalyzeModel: (state, action: PayloadAction<string | null>) => {
      state.shortMemoryAnalyzeModel = action.payload
    },
    // 设置向量化模型
    setVectorizeModel: (state, action: PayloadAction<string | null>) => {
      state.vectorizeModel = action.payload
    },

    // 设置分析状态
    setAnalyzing: (state, action: PayloadAction<boolean>) => {
      state.isAnalyzing = action.payload
      if (action.payload) {
        state.lastAnalyzeTime = Date.now()
      }
    },

    // 批量添加记忆（用于导入）
    importMemories: (state, action: PayloadAction<{ memories: Memory[]; listId?: string }>) => {
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = [defaultList]
      }

      const listId =
        action.payload.listId ||
        state.currentListId ||
        (state.memoryLists.length > 0 ? state.memoryLists[0].id : defaultList.id)

      // 确保 memories 存在
      if (!state.memories) {
        state.memories = []
      }

      // 合并记忆，避免重复
      const existingContents = new Set(state.memories.map((m) => m.content))
      const newMemories = action.payload.memories
        .filter((m) => !existingContents.has(m.content))
        .map((m) => ({ ...m, listId })) // 确保所有导入的记忆都有正确的列表ID

      state.memories = [...state.memories, ...newMemories]

      // 更新记忆列表的更新时间
      const list = state.memoryLists.find((list) => list.id === listId)
      if (list) {
        list.updatedAt = new Date().toISOString()
      }
    },

    // 清空指定列表的记忆
    clearMemories: (state, action: PayloadAction<string | undefined>) => {
      // 确保 memories 存在
      if (!state.memories) {
        state.memories = []
        return
      }

      const listId = action.payload || state.currentListId

      if (listId) {
        // 清空指定列表的记忆
        state.memories = state.memories.filter((memory) => memory.listId !== listId)
      } else {
        // 清空所有记忆
        state.memories = []
      }
    },

    // 添加新的记忆列表
    addMemoryList: (state, action: PayloadAction<{ name: string; description?: string; isActive?: boolean }>) => {
      const newList: MemoryList = {
        id: nanoid(),
        name: action.payload.name,
        description: action.payload.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: action.payload.isActive ?? false
      }
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = []
      }
      state.memoryLists.push(newList)
    },

    // 删除记忆列表
    deleteMemoryList: (state, action: PayloadAction<string>) => {
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = []
        return
      }

      // 删除列表
      state.memoryLists = state.memoryLists.filter((list) => list.id !== action.payload)

      // 删除该列表下的所有记忆
      if (state.memories) {
        state.memories = state.memories.filter((memory) => memory.listId !== action.payload)
      }

      // 如果删除的是当前选中的列表，则切换到第一个列表
      if (state.currentListId === action.payload) {
        state.currentListId = state.memoryLists.length > 0 ? state.memoryLists[0].id : null
      }
    },

    // 编辑记忆列表
    editMemoryList: (state, action: PayloadAction<{ id: string; name?: string; description?: string }>) => {
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = []
        return
      }

      const list = state.memoryLists.find((list) => list.id === action.payload.id)
      if (list) {
        if (action.payload.name) list.name = action.payload.name
        if (action.payload.description !== undefined) list.description = action.payload.description
        list.updatedAt = new Date().toISOString()
      }
    },

    // 设置当前选中的记忆列表
    setCurrentMemoryList: (state, action: PayloadAction<string>) => {
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = []
      }
      state.currentListId = action.payload
    },

    // 切换记忆列表的激活状态
    toggleMemoryListActive: (state, action: PayloadAction<{ id: string; isActive: boolean }>) => {
      // 确保 memoryLists 存在
      if (!state.memoryLists) {
        state.memoryLists = []
        return
      }

      const list = state.memoryLists.find((list) => list.id === action.payload.id)
      if (list) {
        list.isActive = action.payload.isActive
        list.updatedAt = new Date().toISOString()
      }
    },

    // 添加短记忆
    addShortMemory: (
      state,
      action: PayloadAction<{
        content: string
        topicId: string
        analyzedMessageIds?: string[]
        lastMessageId?: string
      }>
    ) => {
      const newShortMemory: ShortMemory = {
        id: nanoid(),
        content: action.payload.content,
        createdAt: new Date().toISOString(),
        topicId: action.payload.topicId,
        analyzedMessageIds: action.payload.analyzedMessageIds,
        lastMessageId: action.payload.lastMessageId
      }

      // 确保 shortMemories 存在
      if (!state.shortMemories) {
        state.shortMemories = []
      }

      state.shortMemories.push(newShortMemory)
    },

    // 删除短记忆
    deleteShortMemory: (state, action: PayloadAction<string>) => {
      // 确保 shortMemories 存在
      if (!state.shortMemories) {
        state.shortMemories = []
        return
      }
      state.shortMemories = state.shortMemories.filter((memory) => memory.id !== action.payload)
    },

    // 清空指定话题的短记忆
    clearShortMemories: (state, action: PayloadAction<string | undefined>) => {
      // 确保 shortMemories 存在
      if (!state.shortMemories) {
        state.shortMemories = []
        return
      }

      const topicId = action.payload

      if (topicId) {
        // 清空指定话题的短记忆
        state.shortMemories = state.shortMemories.filter((memory) => memory.topicId !== topicId)
      } else {
        // 清空所有短记忆
        state.shortMemories = []
      }
    },

    // 设置短记忆功能是否激活
    setShortMemoryActive: (state, action: PayloadAction<boolean>) => {
      state.shortMemoryActive = action.payload
    },

    // 自适应分析相关的reducer
    setAdaptiveAnalysisEnabled: (state, action: PayloadAction<boolean>) => {
      state.adaptiveAnalysisEnabled = action.payload
    },

    setAnalysisFrequency: (state, action: PayloadAction<number>) => {
      state.analysisFrequency = action.payload
    },

    setAnalysisDepth: (state, action: PayloadAction<'low' | 'medium' | 'high'>) => {
      state.analysisDepth = action.payload
    },

    updateAnalysisStats: (state, action: PayloadAction<Partial<AnalysisStats>>) => {
      state.analysisStats = { ...state.analysisStats, ...action.payload }
    },

    // 用户关注点相关的reducer
    setInterestTrackingEnabled: (state, action: PayloadAction<boolean>) => {
      state.interestTrackingEnabled = action.payload
    },

    updateUserInterest: (state, action: PayloadAction<UserInterest>) => {
      const index = state.userInterests.findIndex((i) => i.topic === action.payload.topic)
      if (index >= 0) {
        state.userInterests[index] = action.payload
      } else {
        state.userInterests.push(action.payload)
      }
    },

    // 性能监控相关的reducer
    setMonitoringEnabled: (state, action: PayloadAction<boolean>) => {
      state.monitoringEnabled = action.payload
    },

    updatePerformanceMetrics: (state, action: PayloadAction<Partial<PerformanceMetrics>>) => {
      state.performanceMetrics = { ...state.performanceMetrics, ...action.payload }
    },

    addAnalysisLatency: (state, action: PayloadAction<number>) => {
      // 确保 performanceMetrics 存在
      if (!state.performanceMetrics) {
        state.performanceMetrics = {
          analysisLatency: [],
          memoryRetrievalLatency: [],
          memoryCount: 0,
          shortMemoryCount: 0,
          lastPerformanceCheck: Date.now()
        }
      }

      // 确保 analysisLatency 存在
      if (!state.performanceMetrics.analysisLatency) {
        state.performanceMetrics.analysisLatency = []
      }

      const latencies = [...state.performanceMetrics.analysisLatency, action.payload].slice(-10) // 保留最近10次
      state.performanceMetrics.analysisLatency = latencies
    },

    addMemoryRetrievalLatency: (state, action: PayloadAction<number>) => {
      // 确保 performanceMetrics 存在
      if (!state.performanceMetrics) {
        state.performanceMetrics = {
          analysisLatency: [],
          memoryRetrievalLatency: [],
          memoryCount: 0,
          shortMemoryCount: 0,
          lastPerformanceCheck: Date.now()
        }
      }

      // 确保 memoryRetrievalLatency 存在
      if (!state.performanceMetrics.memoryRetrievalLatency) {
        state.performanceMetrics.memoryRetrievalLatency = []
      }

      const latencies = [...state.performanceMetrics.memoryRetrievalLatency, action.payload].slice(-10) // 保留最近10次
      state.performanceMetrics.memoryRetrievalLatency = latencies
    },

    // 智能优先级与时效性管理相关的reducer
    setPriorityManagementEnabled: (state, action: PayloadAction<boolean>) => {
      state.priorityManagementEnabled = action.payload
    },

    setDecayEnabled: (state, action: PayloadAction<boolean>) => {
      state.decayEnabled = action.payload
    },

    setFreshnessEnabled: (state, action: PayloadAction<boolean>) => {
      state.freshnessEnabled = action.payload
    },

    setDecayRate: (state, action: PayloadAction<number>) => {
      state.decayRate = action.payload
    },

    // 更新记忆优先级
    updateMemoryPriorities: (state) => {
      const now = Date.now()

      // 更新长期记忆优先级
      if (state.memories && state.memories.length > 0) {
        state.memories.forEach(memory => {
          // 计算时间衰减因子
          if (state.decayEnabled && memory.lastAccessedAt) {
            const daysSinceLastAccess = (now - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24)
            const decayFactor = Math.max(0, 1 - (daysSinceLastAccess * state.decayRate))
            memory.decayFactor = decayFactor
          } else {
            memory.decayFactor = 1 // 无衰减
          }

          // 计算鲜度评分
          if (state.freshnessEnabled) {
            const daysSinceCreation = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24)
            const lastAccessDays = memory.lastAccessedAt
              ? (now - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24)
              : daysSinceCreation

            // 鲜度评分结合创建时间和最后访问时间
            const creationFreshness = Math.max(0, 1 - (daysSinceCreation / 30)) // 30天内创建的记忆较新
            const accessFreshness = Math.max(0, 1 - (lastAccessDays / 7)) // 7天内访问的记忆较新
            memory.freshness = (creationFreshness * 0.3) + (accessFreshness * 0.7) // 加权平均
          }
        })
      }

      // 更新短期记忆优先级
      if (state.shortMemories && state.shortMemories.length > 0) {
        state.shortMemories.forEach(memory => {
          // 计算时间衰减因子
          if (state.decayEnabled && memory.lastAccessedAt) {
            const hoursSinceLastAccess = (now - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60)
            const decayFactor = Math.max(0, 1 - (hoursSinceLastAccess * state.decayRate * 4)) // 短期记忆衰减更快
            memory.decayFactor = decayFactor
          } else {
            memory.decayFactor = 1 // 无衰减
          }

          // 计算鲜度评分
          if (state.freshnessEnabled) {
            const hoursSinceCreation = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60)
            const lastAccessHours = memory.lastAccessedAt
              ? (now - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60)
              : hoursSinceCreation

            // 短期记忆的鲜度评分更注重最近性
            const creationFreshness = Math.max(0, 1 - (hoursSinceCreation / 24)) // 24小时内创建的记忆较新
            const accessFreshness = Math.max(0, 1 - (lastAccessHours / 6)) // 6小时内访问的记忆较新
            memory.freshness = (creationFreshness * 0.2) + (accessFreshness * 0.8) // 加权平均，更注重访问时间
          }
        })
      }

      state.lastPriorityUpdate = now
    },

    // 更新记忆鲜度
    updateMemoryFreshness: (state) => {
      if (!state.freshnessEnabled) return

      const now = Date.now()

      // 更新长期记忆鲜度
      if (state.memories && state.memories.length > 0) {
        state.memories.forEach(memory => {
          const daysSinceCreation = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24)
          const lastAccessDays = memory.lastAccessedAt
            ? (now - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24)
            : daysSinceCreation

          const creationFreshness = Math.max(0, 1 - (daysSinceCreation / 30))
          const accessFreshness = Math.max(0, 1 - (lastAccessDays / 7))
          memory.freshness = (creationFreshness * 0.3) + (accessFreshness * 0.7)
        })
      }

      // 更新短期记忆鲜度
      if (state.shortMemories && state.shortMemories.length > 0) {
        state.shortMemories.forEach(memory => {
          const hoursSinceCreation = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60)
          const lastAccessHours = memory.lastAccessedAt
            ? (now - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60)
            : hoursSinceCreation

          const creationFreshness = Math.max(0, 1 - (hoursSinceCreation / 24))
          const accessFreshness = Math.max(0, 1 - (lastAccessHours / 6))
          memory.freshness = (creationFreshness * 0.2) + (accessFreshness * 0.8)
        })
      }
    },

    // 记录记忆访问
    accessMemory: (state, action: PayloadAction<{ id: string; isShortMemory?: boolean }>) => {
      const { id, isShortMemory } = action.payload
      const now = new Date().toISOString()

      if (isShortMemory) {
        // 更新短期记忆访问信息
        const memory = state.shortMemories?.find(m => m.id === id)
        if (memory) {
          memory.accessCount = (memory.accessCount || 0) + 1
          memory.lastAccessedAt = now
        }
      } else {
        // 更新长期记忆访问信息
        const memory = state.memories?.find(m => m.id === id)
        if (memory) {
          memory.accessCount = (memory.accessCount || 0) + 1
          memory.lastAccessedAt = now
        }
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadMemoryData.fulfilled, (state, action) => {
        if (action.payload) {
          // 更新状态中的记忆数据
          state.memoryLists = action.payload.memoryLists || state.memoryLists
          state.memories = action.payload.memories || state.memories
          state.shortMemories = action.payload.shortMemories || state.shortMemories
          log.info('Memory data loaded into state')
        }
      })
  }
})

export const {
  addMemory,
  deleteMemory,
  editMemory,
  setMemoryActive,
  setAutoAnalyze,
  setAnalyzeModel,
  setShortMemoryAnalyzeModel,
  setVectorizeModel,
  setAnalyzing,
  importMemories,
  clearMemories,
  addMemoryList,
  deleteMemoryList,
  editMemoryList,
  setCurrentMemoryList,
  toggleMemoryListActive,
  // 短记忆相关的action
  addShortMemory,
  deleteShortMemory,
  clearShortMemories,
  setShortMemoryActive,

  // 自适应分析相关的action
  setAdaptiveAnalysisEnabled,
  setAnalysisFrequency,
  setAnalysisDepth,
  updateAnalysisStats,

  // 用户关注点相关的action
  setInterestTrackingEnabled,
  updateUserInterest,

  // 性能监控相关的action
  setMonitoringEnabled,
  updatePerformanceMetrics,
  addAnalysisLatency,
  addMemoryRetrievalLatency,

  // 智能优先级与时效性管理相关的action
  setPriorityManagementEnabled,
  setDecayEnabled,
  setFreshnessEnabled,
  setDecayRate,
  updateMemoryPriorities,
  updateMemoryFreshness,
  accessMemory
} = memorySlice.actions

// 加载记忆数据的异步 thunk
export const loadMemoryData = createAsyncThunk(
  'memory/loadData',
  async () => {
    try {
      // log.info('Loading memory data from file...') // Removed direct log call from renderer
      const data = await window.api.memory.loadData()
      // log.info('Memory data loaded successfully') // Removed direct log call from renderer
      return data
    } catch (error) {
      console.error('Failed to load memory data:', error) // Use console.error instead of log.error
      return null // Ensure the thunk returns null on error
    }
  } // <-- Add missing closing brace for the async function
)

// 保存记忆数据的异步 thunk
export const saveMemoryData = createAsyncThunk(
  'memory/saveData',
  async (data: Partial<MemoryState>) => {
    try {
      // log.info('Saving memory data to file...') // Removed direct log call from renderer
      const result = await window.api.memory.saveData(data)
      // log.info('Memory data saved successfully') // Removed direct log call from renderer
      return result
    } catch (error) {
      console.error('Failed to save memory data:', error) // Use console.error instead of log.error
      return false
    }
  }
)

// Middleware removed to prevent duplicate saves triggered by batch additions.
// Explicit saves should be handled where needed, e.g., at the end of analysis functions.
export default memorySlice.reducer

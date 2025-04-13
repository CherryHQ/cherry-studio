// src/main/mcpServers/simpleremember.ts
import { getConfigDir } from '@main/utils/file'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js'
import { Mutex } from 'async-mutex'
import { promises as fs } from 'fs'
import path from 'path'

// 定义记忆文件路径
const defaultMemoryPath = path.join(getConfigDir(), 'simpleremember.json')

// 记忆项接口
interface Memory {
  content: string
  createdAt: string
}

// 记忆存储结构
interface MemoryStorage {
  memories: Memory[]
}

class SimpleRememberManager {
  private memoryPath: string
  private memories: Memory[] = []
  private fileMutex: Mutex = new Mutex()

  constructor(memoryPath: string) {
    this.memoryPath = memoryPath
  }

  // 静态工厂方法用于初始化
  public static async create(memoryPath: string): Promise<SimpleRememberManager> {
    const manager = new SimpleRememberManager(memoryPath)
    await manager._ensureMemoryPathExists()
    await manager._loadMemoriesFromDisk()
    return manager
  }

  // 确保记忆文件存在
  private async _ensureMemoryPathExists(): Promise<void> {
    try {
      const directory = path.dirname(this.memoryPath)
      await fs.mkdir(directory, { recursive: true })
      try {
        await fs.access(this.memoryPath)
      } catch (error) {
        // 文件不存在，创建一个空文件
        await fs.writeFile(this.memoryPath, JSON.stringify({ memories: [] }, null, 2))
      }
    } catch (error) {
      console.error('Failed to ensure memory path exists:', error)
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to ensure memory path: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // 从磁盘加载记忆
  private async _loadMemoriesFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf-8')
      // 处理空文件情况
      if (data.trim() === '') {
        this.memories = []
        await this._persistMemories()
        return
      }
      const storage: MemoryStorage = JSON.parse(data)
      this.memories = storage.memories || []
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        this.memories = []
        await this._persistMemories()
      } else if (error instanceof SyntaxError) {
        console.error('Failed to parse simpleremember.json, initializing with empty memories:', error)
        this.memories = []
        await this._persistMemories()
      } else {
        console.error('Unexpected error loading memories:', error)
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to load memories: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  // 将记忆持久化到磁盘
  private async _persistMemories(): Promise<void> {
    const release = await this.fileMutex.acquire()
    try {
      const storage: MemoryStorage = {
        memories: this.memories
      }
      await fs.writeFile(this.memoryPath, JSON.stringify(storage, null, 2))
    } catch (error) {
      console.error('Failed to save memories:', error)
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to save memories: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      release()
    }
  }

  // 添加新记忆
  async remember(memory: string): Promise<Memory> {
    const newMemory: Memory = {
      content: memory,
      createdAt: new Date().toISOString()
    }
    this.memories.push(newMemory)
    await this._persistMemories()
    return newMemory
  }

  // 获取所有记忆
  async getAllMemories(): Promise<Memory[]> {
    return [...this.memories]
  }

  // 获取记忆 - 这个方法会被get_memories工具调用
  async get_memories(): Promise<Memory[]> {
    return this.getAllMemories()
  }
}

// 定义工具 - 按照MCP规范定义工具
const REMEMBER_TOOL = {
  name: 'remember',
  description:
    '用于记忆长期有用信息的工具。这个工具会自动应用记忆，无需显式调用。只用于存储长期有用的信息，不适合临时信息。',
  inputSchema: {
    type: 'object',
    properties: {
      memory: {
        type: 'string',
        description: '要记住的简洁(1句话)记忆内容'
      }
    },
    required: ['memory']
  }
}

const GET_MEMORIES_TOOL = {
  name: 'get_memories',
  description: '获取所有已存储的记忆',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}

// 添加日志以便调试
console.log('[SimpleRemember] Defined tools:', { REMEMBER_TOOL, GET_MEMORIES_TOOL })

class SimpleRememberServer {
  public server: Server
  private simpleRememberManager: SimpleRememberManager | null = null
  private initializationPromise: Promise<void>

  constructor(envPath: string = '') {
    const memoryPath = envPath ? (path.isAbsolute(envPath) ? envPath : path.resolve(envPath)) : defaultMemoryPath

    console.log('[SimpleRemember] Creating server with memory path:', memoryPath)

    // 初始化服务器
    this.server = new Server(
      {
        name: 'simple-remember-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {
            // 按照MCP规范声明工具能力
            listChanged: true
          },
          // 添加空的prompts能力，表示支持提示词功能但没有实际的提示词
          prompts: {}
        }
      }
    )

    console.log('[SimpleRemember] Server initialized with tools capability')

    // 手动添加工具到服务器的工具列表中
    console.log('[SimpleRemember] Adding tools to server')

    // 先设置请求处理程序，再初始化管理器
    this.setupRequestHandlers()
    this.initializationPromise = this._initializeManager(memoryPath)

    console.log('[SimpleRemember] Server initialization complete')
    // 打印工具信息以确认它们已注册
    console.log('[SimpleRemember] Tools registered:', [REMEMBER_TOOL.name, GET_MEMORIES_TOOL.name])
  }

  private async _initializeManager(memoryPath: string): Promise<void> {
    try {
      this.simpleRememberManager = await SimpleRememberManager.create(memoryPath)
      console.log('SimpleRememberManager initialized successfully.')
    } catch (error) {
      console.error('Failed to initialize SimpleRememberManager:', error)
      this.simpleRememberManager = null
    }
  }

  private async _getManager(): Promise<SimpleRememberManager> {
    if (!this.simpleRememberManager) {
      await this.initializationPromise
      if (!this.simpleRememberManager) {
        throw new McpError(ErrorCode.InternalError, 'SimpleRememberManager is not initialized')
      }
    }
    return this.simpleRememberManager
  }

  setupRequestHandlers() {
    // 添加对prompts/list请求的处理
    this.server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      console.log('[SimpleRemember] Listing prompts request received', request)

      // 返回空的提示词列表
      return {
        prompts: []
      }
    })

    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      // 直接返回工具列表，不需要等待管理器初始化
      console.log('[SimpleRemember] Listing tools request received', request)

      // 打印工具定义以确保它们存在
      console.log('[SimpleRemember] REMEMBER_TOOL:', JSON.stringify(REMEMBER_TOOL))
      console.log('[SimpleRemember] GET_MEMORIES_TOOL:', JSON.stringify(GET_MEMORIES_TOOL))

      const toolsList = [REMEMBER_TOOL, GET_MEMORIES_TOOL]
      console.log('[SimpleRemember] Returning tools:', JSON.stringify(toolsList))

      // 按照MCP规范返回工具列表
      return {
        tools: toolsList
        // 如果有分页，可以添加nextCursor
        // nextCursor: "next-page-cursor"
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      console.log(`[SimpleRemember] Received tool call: ${name}`, args)

      try {
        const manager = await this._getManager()

        if (name === 'remember') {
          if (!args || typeof args.memory !== 'string') {
            console.error(`[SimpleRemember] Invalid arguments for ${name}:`, args)
            throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: 'memory' string is required.`)
          }
          console.log(`[SimpleRemember] Remembering: "${args.memory}"`)
          const result = await manager.remember(args.memory)
          console.log(`[SimpleRemember] Memory saved successfully:`, result)
          // 按照MCP规范返回工具调用结果
          return {
            content: [
              {
                type: 'text',
                text: `记忆已保存: "${args.memory}"`
              }
            ],
            isError: false
          }
        }

        if (name === 'get_memories') {
          console.log(`[SimpleRemember] Getting all memories`)
          const memories = await manager.get_memories()
          console.log(`[SimpleRemember] Retrieved ${memories.length} memories`)
          // 按照MCP规范返回工具调用结果
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(memories, null, 2)
              }
            ],
            isError: false
          }
        }

        console.error(`[SimpleRemember] Unknown tool: ${name}`)
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
      } catch (error) {
        console.error(`[SimpleRemember] Error handling tool call ${name}:`, error)
        // 按照MCP规范返回工具调用错误
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        }
      }
    })
  }
}

export default SimpleRememberServer

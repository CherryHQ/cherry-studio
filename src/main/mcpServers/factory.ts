import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { BuiltinMCPServerName } from '@types'
import { BuiltinMCPServerNames } from '@types'

import BraveSearchServer from './brave-search'
import DiDiMcpServer from './didi-mcp'
import DifyKnowledgeServer from './dify-knowledge'
import FetchServer from './fetch'
import FileSystemServer from './filesystem'
import MemoryServer from './memory'
import PythonServer from './python'
import ThinkingServer from './sequentialthinking'

const logger = loggerService.withContext('MCPFactory')

export function createInMemoryMCPServer(
  name: BuiltinMCPServerName,
  args: string[] = [],
  envs: Record<string, string> = {}
): Server {
  logger.debug(`[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(envs)}`)
  switch (name) {
    case BuiltinMCPServerNames.memory: {
      const envPath = envs.MEMORY_FILE_PATH
      return new MemoryServer(envPath).server
    }
    case BuiltinMCPServerNames.sequentialThinking: {
      return new ThinkingServer().server
    }
    case BuiltinMCPServerNames.braveSearch: {
      return new BraveSearchServer(envs.BRAVE_API_KEY).server
    }
    case BuiltinMCPServerNames.fetch: {
      return new FetchServer().server
    }
    case BuiltinMCPServerNames.filesystem: {
      return new FileSystemServer(args).server
    }
    case BuiltinMCPServerNames.difyKnowledge: {
      const difyKey = envs.DIFY_KEY
      return new DifyKnowledgeServer(difyKey, args).server
    }
    case BuiltinMCPServerNames.python: {
      // 从环境变量中解析 Python MCP 配置
      const pythonConfig: {
        pyodideIndexURL?: string
        preloadPackages?: string[]
        disableAutoLoad?: boolean
      } = {}

      if (envs.PYODIDE_INDEX_URL) {
        pythonConfig.pyodideIndexURL = envs.PYODIDE_INDEX_URL
      }

      if (envs.PYODIDE_PRELOAD_PACKAGES) {
        try {
          pythonConfig.preloadPackages = JSON.parse(envs.PYODIDE_PRELOAD_PACKAGES) as string[]
        } catch (error) {
          logger.warn('Failed to parse PYODIDE_PRELOAD_PACKAGES, using comma-separated format', { error })
          // 如果 JSON 解析失败，尝试逗号分隔格式
          pythonConfig.preloadPackages = envs.PYODIDE_PRELOAD_PACKAGES.split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        }
      }

      if (envs.PYODIDE_DISABLE_AUTO_LOAD) {
        pythonConfig.disableAutoLoad =
          envs.PYODIDE_DISABLE_AUTO_LOAD === 'true' || envs.PYODIDE_DISABLE_AUTO_LOAD === '1'
      }

      return new PythonServer(pythonConfig).server
    }
    case BuiltinMCPServerNames.didiMCP: {
      const apiKey = envs.DIDI_API_KEY
      return new DiDiMcpServer(apiKey).server
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}

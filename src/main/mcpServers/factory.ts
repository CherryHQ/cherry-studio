import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import Logger from 'electron-log'

import BraveSearchServer from './brave-search'
import FetchServer from './fetch'
import FileSystemServer from './filesystem'
import MemoryServer from './memory'
import ThinkingServer from './sequentialthinking'
import SimpleRememberServer from './simpleremember'

export function createInMemoryMCPServer(name: string, args: string[] = [], envs: Record<string, string> = {}): Server {
  Logger.info(`[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(envs)}`)
  switch (name) {
    case '@cherry/memory': {
      const envPath = envs.MEMORY_FILE_PATH
      return new MemoryServer(envPath).server
    }
    case '@cherry/sequentialthinking': {
      return new ThinkingServer().server
    }
    case '@cherry/brave-search': {
      return new BraveSearchServer(envs.BRAVE_API_KEY).server
    }
    case '@cherry/fetch': {
      return new FetchServer().server
    }
    case '@cherry/filesystem': {
      return new FileSystemServer(args).server
    }
    case '@cherry/simpleremember': {
      const envPath = envs.SIMPLEREMEMBER_FILE_PATH
      return new SimpleRememberServer(envPath).server
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}

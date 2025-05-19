import path from 'node:path'

import { LibSQLVectorStore } from '@langchain/community/vectorstores/libsql'
import { createClient } from '@libsql/client'
import Embeddings from '@main/embeddings/Embeddings'
import { KnowledgeBaseParams } from '@types'
import { app } from 'electron'
import {
  AddMemoryOptions,
  DeleteAllMemoryOptions,
  GetAllMemoryOptions,
  Memory,
  Message,
  SearchMemoryOptions
} from 'mem0ai/oss'

function createMemory({ model, apiKey, apiVersion, baseURL, dimensions }: KnowledgeBaseParams): Memory {
  // https://docs.mem0.ai/components/vectordbs/dbs/langchain
  const storageDir = path.join(app.getPath('userData'), 'Data', 'Memory')
  // const embeddings = new OpenAIEmbeddings()
  const embeddings = new Embeddings({ model, apiKey, apiVersion, baseURL, dimensions } as KnowledgeBaseParams)
  const libsqlClient = createClient({
    url: `file:///${path.join(storageDir, 'memory.db')}`
  })
  const vectorStore = new LibSQLVectorStore(embeddings, { db: libsqlClient, table: 'mem0' })
  return new Memory({
    version: 'v0.1',
    vectorStore: {
      provider: 'langchain',
      config: { client: vectorStore }
    },
    historyDbPath: `${path.join(storageDir, 'history.db')}`
  })
}

class MemoryService {
  private static instance: MemoryService
  private memory!: Memory
  private initPromise: Promise<void> | null = null

  private constructor() {
    // Private constructor to prevent instantiation
  }

  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }

  private async initMemory(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // TODO: get from config
        this.memory = createMemory({} as KnowledgeBaseParams)
        if (typeof (this.memory as any).init === 'function') {
          await (this.memory as any).init()
        }
      })()
    }
    return this.initPromise
  }

  async init(): Promise<void> {
    return this.initMemory()
  }

  async add(messages: string | Message[], options: AddMemoryOptions) {
    await this.initMemory()
    return this.memory.add(messages, options)
  }

  async getAll(options: GetAllMemoryOptions) {
    await this.initMemory()
    return this.memory.getAll(options)
  }

  async get(memoryId: string) {
    await this.initMemory()
    return this.memory.get(memoryId)
  }

  async search(query: string, options: SearchMemoryOptions) {
    await this.initMemory()
    return this.memory.search(query, options)
  }

  async update(memoryId: string, data: string) {
    await this.initMemory()
    return this.memory.update(memoryId, data)
  }

  async history(memoryId: string) {
    await this.initMemory()
    return this.memory.history(memoryId)
  }

  async delete(memoryId: string) {
    await this.initMemory()
    return this.memory.delete(memoryId)
  }

  async deleteAll(options: DeleteAllMemoryOptions) {
    await this.initMemory()
    return this.memory.deleteAll(options)
  }

  async reset() {
    await this.initMemory()
    return this.memory.reset()
  }
}

export default MemoryService.getInstance()

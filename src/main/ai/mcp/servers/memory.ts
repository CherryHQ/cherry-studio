import { promises as fs } from 'fs'
import path from 'path'

import { McpServer } from '@modelcontextprotocol/server'
import { Mutex } from 'async-mutex' // 引入 Mutex
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { TraceMethod } from '@main/ai/observability'
import { atomicWriteFile, realpath } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import type { BuiltinMcpEndpoint } from './factory'

const logger = loggerService.withContext('McpServer:Memory')

// Define memory file path
const getDefaultMemoryPath = () => application.getPath('feature.mcp.memory_file')

// Interfaces remain the same
interface Entity {
  name: string
  entityType: string
  observations: string[]
}

interface Relation {
  from: string
  to: string
  relationType: string
}

const RelationSchema = z.object({
  from: z.string().describe('The name of the entity where the relation starts'),
  to: z.string().describe('The name of the entity where the relation ends'),
  relationType: z.string().describe('The type of the relation')
})

// Structure for storing the graph in memory and in the file
interface KnowledgeGraph {
  entities: Entity[]
  relations: Relation[]
}

// Loose entities keep fields this server does not know about when the file is rewritten.
const KnowledgeGraphFileSchema = z.object({
  entities: z
    .array(z.looseObject({ name: z.string(), entityType: z.string(), observations: z.array(z.string()).default([]) }))
    .default([]),
  relations: z.array(RelationSchema).default([])
})

const sameRelation = (a: Relation, b: Relation) =>
  a.from === b.from && a.to === b.to && a.relationType === b.relationType

class KnowledgeGraphManager {
  private readonly memoryPath: AbsoluteFilePath
  private readonly fileMutex = new Mutex()

  private constructor(memoryPath: string) {
    this.memoryPath = AbsoluteFilePathSchema.parse(memoryPath)
  }

  @TraceMethod({ spanName: 'create', tag: 'KnowledgeGraph' })
  public static async create(memoryPath: string): Promise<KnowledgeGraphManager> {
    const manager = new KnowledgeGraphManager(memoryPath)
    await fs.mkdir(path.dirname(manager.memoryPath), { recursive: true })
    return manager
  }

  private async resolveTarget(): Promise<AbsoluteFilePath> {
    try {
      return await realpath(this.memoryPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.memoryPath
      throw error
    }
  }

  private async loadGraph(target: AbsoluteFilePath): Promise<KnowledgeGraph> {
    let data: string
    try {
      data = await fs.readFile(target, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entities: [], relations: [] }
      throw error
    }
    if (data.trim() === '') return { entities: [], relations: [] }
    try {
      return KnowledgeGraphFileSchema.parse(JSON.parse(data))
    } catch (error) {
      const backupPath = `${target}.corrupt-${Date.now()}`
      await fs.rename(target, backupPath)
      logger.error(
        `Failed to parse memory file, moved it to ${backupPath} and started with an empty graph:`,
        error as Error
      )
      return { entities: [], relations: [] }
    }
  }

  private readGraph(): Promise<KnowledgeGraph> {
    return this.fileMutex.runExclusive(async () => this.loadGraph(await this.resolveTarget()))
  }

  private updateGraph<T>(mutate: (graph: KnowledgeGraph) => { result: T; changed: boolean }): Promise<T> {
    return this.fileMutex.runExclusive(async () => {
      const target = await this.resolveTarget()
      const graph = await this.loadGraph(target)
      const { result, changed } = mutate(graph)
      if (changed) {
        try {
          const mode = await fs.stat(target).then(
            (stats) => stats.mode & 0o777,
            () => undefined
          )
          await atomicWriteFile(target, JSON.stringify(graph, null, 2), { mode })
        } catch (error) {
          logger.error('Failed to save knowledge graph:', error as Error)
          throw error
        }
      }
      return result
    })
  }

  @TraceMethod({ spanName: 'createEntities', tag: 'KnowledgeGraph' })
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.updateGraph((graph) => {
      const created: Entity[] = []
      for (const entity of entities) {
        if (graph.entities.some((e) => e.name === entity.name)) continue
        const newEntity = { ...entity, observations: Array.isArray(entity.observations) ? entity.observations : [] }
        graph.entities.push(newEntity)
        created.push(newEntity)
      }
      return { result: created, changed: created.length > 0 }
    })
  }

  @TraceMethod({ spanName: 'createRelations', tag: 'KnowledgeGraph' })
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    return this.updateGraph((graph) => {
      const created: Relation[] = []
      for (const relation of relations) {
        const hasEntity = (name: string) => graph.entities.some((e) => e.name === name)
        if (!hasEntity(relation.from) || !hasEntity(relation.to)) {
          logger.warn(`Skipping relation creation: Entity not found for relation ${relation.from} -> ${relation.to}`)
          continue
        }
        if (graph.relations.some((r) => sameRelation(r, relation))) continue
        const newRelation = { from: relation.from, to: relation.to, relationType: relation.relationType }
        graph.relations.push(newRelation)
        created.push(newRelation)
      }
      return { result: created, changed: created.length > 0 }
    })
  }

  @TraceMethod({ spanName: 'addObservtions', tag: 'KnowledgeGraph' })
  async addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    return this.updateGraph((graph) => {
      const results = observations.map((o) => {
        const entity = graph.entities.find((e) => e.name === o.entityName)
        if (!entity) {
          throw new Error(`Entity with name ${o.entityName} not found`)
        }
        const addedObservations = o.contents.filter((content) => !entity.observations.includes(content))
        entity.observations.push(...addedObservations)
        return { entityName: o.entityName, addedObservations }
      })
      return { result: results, changed: results.some((r) => r.addedObservations.length > 0) }
    })
  }

  @TraceMethod({ spanName: 'deleteEntities', tag: 'KnowledgeGraph' })
  async deleteEntities(entityNames: string[]): Promise<void> {
    return this.updateGraph((graph) => {
      const names = new Set(entityNames)
      const entities = graph.entities.filter((e) => !names.has(e.name))
      const relations = graph.relations.filter((r) => !names.has(r.from) && !names.has(r.to))
      const changed = entities.length !== graph.entities.length || relations.length !== graph.relations.length
      graph.entities = entities
      graph.relations = relations
      return { result: undefined, changed }
    })
  }

  @TraceMethod({ spanName: 'deleteObservations', tag: 'KnowledgeGraph' })
  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    return this.updateGraph((graph) => {
      let changed = false
      for (const d of deletions) {
        const entity = graph.entities.find((e) => e.name === d.entityName)
        if (!entity) continue
        const observationsToDelete = new Set(d.observations)
        const kept = entity.observations.filter((o) => !observationsToDelete.has(o))
        if (kept.length !== entity.observations.length) {
          entity.observations = kept
          changed = true
        }
      }
      return { result: undefined, changed }
    })
  }

  @TraceMethod({ spanName: 'deleteRelations', tag: 'KnowledgeGraph' })
  async deleteRelations(relations: Relation[]): Promise<void> {
    return this.updateGraph((graph) => {
      const kept = graph.relations.filter((r) => !relations.some((d) => sameRelation(r, d)))
      const changed = kept.length !== graph.relations.length
      graph.relations = kept
      return { result: undefined, changed }
    })
  }

  @TraceMethod({ spanName: 'readGraph', tag: 'KnowledgeGraph' })
  async serializeGraph(): Promise<string> {
    return JSON.stringify(await this.readGraph(), null, 2)
  }

  @TraceMethod({ spanName: 'searchNodes', tag: 'KnowledgeGraph' })
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.readGraph()
    const lowerCaseQuery = query.toLowerCase()
    const filteredEntities = graph.entities.filter(
      (e) =>
        e.name.toLowerCase().includes(lowerCaseQuery) ||
        e.entityType.toLowerCase().includes(lowerCaseQuery) ||
        e.observations.some((o) => o.toLowerCase().includes(lowerCaseQuery))
    )
    const filteredEntityNames = new Set(filteredEntities.map((e) => e.name))
    const filteredRelations = graph.relations.filter(
      (r) => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    )
    return { entities: filteredEntities, relations: filteredRelations }
  }

  @TraceMethod({ spanName: 'openNodes', tag: 'KnowledgeGraph' })
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.readGraph()
    const nameSet = new Set(names)
    const filteredEntities = graph.entities.filter((e) => nameSet.has(e.name))
    const filteredEntityNames = new Set(filteredEntities.map((e) => e.name))
    const filteredRelations = graph.relations.filter(
      (r) => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    )
    return { entities: filteredEntities, relations: filteredRelations }
  }
}

/**
 * Builtin memory endpoint. The memory file is the only state: every tool call reads it, and every
 * change rewrites it atomically, so a failed write leaves nothing half-applied.
 */
export function createMemoryEndpoint(envPath = ''): BuiltinMcpEndpoint {
  const memoryPath = envPath
    ? path.isAbsolute(envPath)
      ? envPath
      : path.resolve(envPath) // Use path.resolve for relative paths based on CWD
    : getDefaultMemoryPath()
  const manager = KnowledgeGraphManager.create(memoryPath).catch((error: unknown) => {
    logger.error('Failed to initialize KnowledgeGraphManager:', error as Error)
    return null
  })
  const getManager = async (): Promise<KnowledgeGraphManager> => {
    const initialized = await manager
    if (!initialized) throw new Error('Memory server failed to initialize. Cannot process requests.')
    return initialized
  }

  return {
    createServer: () => {
      const server = new McpServer({ name: 'memory-server', version: '1.1.0' })
      registerMemoryTools(server, getManager)
      return server
    },
    close: async () => undefined
  }
}

function registerMemoryTools(server: McpServer, getManager: () => Promise<KnowledgeGraphManager>): void {
  const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })

  server.registerTool(
    'create_entities',
    {
      description: 'Create multiple new entities in the knowledge graph. Skips existing entities.',
      inputSchema: z.object({
        entities: z.array(
          z.object({
            name: z.string().describe('The name of the entity'),
            entityType: z.string().describe('The type of the entity'),
            observations: z
              .array(z.string())
              .default([])
              .describe('An array of observation contents associated with the entity')
          })
        )
      })
    },
    async ({ entities }) => json(await (await getManager()).createEntities(entities))
  )

  server.registerTool(
    'create_relations',
    {
      description: 'Create relations between existing entities. Skips duplicates and missing entities.',
      inputSchema: z.object({ relations: z.array(RelationSchema) })
    },
    async ({ relations }) => json(await (await getManager()).createRelations(relations))
  )

  server.registerTool(
    'add_observations',
    {
      description: 'Add new observations to existing entities. Skips duplicate observations.',
      inputSchema: z.object({
        observations: z.array(
          z.object({
            entityName: z.string().describe('The name of the entity to add the observations to'),
            contents: z.array(z.string()).describe('An array of observation contents to add')
          })
        )
      })
    },
    async ({ observations }) => json(await (await getManager()).addObservations(observations))
  )

  server.registerTool(
    'delete_entities',
    {
      description: 'Delete multiple entities and their associated relations.',
      inputSchema: z.object({
        entityNames: z.array(z.string()).describe('An array of entity names to delete')
      })
    },
    async ({ entityNames }) => {
      await (await getManager()).deleteEntities(entityNames)
      return text('Entities deleted successfully')
    }
  )

  server.registerTool(
    'delete_observations',
    {
      description: 'Delete specific observations from entities.',
      inputSchema: z.object({
        deletions: z.array(
          z.object({
            entityName: z.string().describe('The name of the entity containing the observations'),
            observations: z.array(z.string()).describe('An array of observations to delete')
          })
        )
      })
    },
    async ({ deletions }) => {
      await (await getManager()).deleteObservations(deletions)
      return text('Observations deleted successfully')
    }
  )

  server.registerTool(
    'delete_relations',
    {
      description: 'Delete multiple specific relations.',
      inputSchema: z.object({
        relations: z.array(RelationSchema).describe('An array of relations to delete')
      })
    },
    async ({ relations }) => {
      await (await getManager()).deleteRelations(relations)
      return text('Relations deleted successfully')
    }
  )

  server.registerTool('read_graph', { description: 'Read the entire knowledge graph from memory.' }, async () =>
    text(await (await getManager()).serializeGraph())
  )

  server.registerTool(
    'search_nodes',
    {
      description: 'Search nodes (entities and relations) in memory based on a query.',
      inputSchema: z.object({
        query: z.string().describe('The search query to match against entity names, types, and observation content')
      })
    },
    async ({ query }) => json(await (await getManager()).searchNodes(query))
  )

  server.registerTool(
    'open_nodes',
    {
      description: 'Retrieve specific entities and their connecting relations from memory by name.',
      inputSchema: z.object({
        names: z.array(z.string()).describe('An array of entity names to retrieve')
      })
    },
    async ({ names }) => json(await (await getManager()).openNodes(names))
  )
}

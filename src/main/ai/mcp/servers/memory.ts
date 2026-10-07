import { promises as fs } from 'fs'
import path from 'path'

import { McpServer } from '@modelcontextprotocol/server'
import { Mutex } from 'async-mutex' // 引入 Mutex
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { TraceMethod } from '@main/ai/observability'

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

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private memoryPath: string
  private entities: Map<string, Entity> // Use Map for efficient entity lookup
  private relations: Set<string> // Store stringified relations for easy Set operations
  private fileMutex: Mutex // Mutex for file writing

  private constructor(memoryPath: string) {
    this.memoryPath = memoryPath
    this.entities = new Map<string, Entity>()
    this.relations = new Set<string>()
    this.fileMutex = new Mutex()
  }

  // Static async factory method for initialization
  @TraceMethod({ spanName: 'create', tag: 'KnowledgeGraph' })
  public static async create(memoryPath: string): Promise<KnowledgeGraphManager> {
    const manager = new KnowledgeGraphManager(memoryPath)
    await manager._ensureMemoryPathExists()
    await manager._loadGraphFromDisk()
    return manager
  }

  private async _ensureMemoryPathExists(): Promise<void> {
    try {
      const directory = path.dirname(this.memoryPath)
      await fs.mkdir(directory, { recursive: true })
      try {
        await fs.access(this.memoryPath)
      } catch (error) {
        // File doesn't exist, create an empty file with initial structure
        await fs.writeFile(this.memoryPath, JSON.stringify({ entities: [], relations: [] }, null, 2))
      }
    } catch (error) {
      logger.error('Failed to ensure memory path exists:', error as Error)
      throw error
    }
  }

  // Load graph from disk into memory (called once during initialization)
  private async _loadGraphFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf-8')
      // Handle empty file case
      if (data.trim() === '') {
        this.entities = new Map()
        this.relations = new Set()
        // Optionally write the initial empty structure back
        await this._persistGraph()
        return
      }
      const graph: KnowledgeGraph = JSON.parse(data)
      this.entities.clear()
      this.relations.clear()
      graph.entities.forEach((entity) => this.entities.set(entity.name, entity))
      graph.relations.forEach((relation) => this.relations.add(this._serializeRelation(relation)))
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        // File doesn't exist (should have been created by _ensureMemoryPathExists, but handle defensively)
        this.entities = new Map()
        this.relations = new Set()
        await this._persistGraph() // Create the file with empty structure
      } else if (error instanceof SyntaxError) {
        logger.error('Failed to parse memory.json, initializing with empty graph:', error)
        // If JSON is invalid, start fresh and overwrite the corrupted file
        this.entities = new Map()
        this.relations = new Set()
        await this._persistGraph()
      } else {
        logger.error('Failed to load knowledge graph from disk:', error as Error)
        throw error
      }
    }
  }

  // Persist the current in-memory graph to disk using a mutex
  private async _persistGraph(): Promise<void> {
    const release = await this.fileMutex.acquire()
    try {
      const graphData: KnowledgeGraph = {
        entities: Array.from(this.entities.values()),
        relations: Array.from(this.relations).map((rStr) => this._deserializeRelation(rStr))
      }
      await fs.writeFile(this.memoryPath, JSON.stringify(graphData, null, 2))
    } catch (error) {
      logger.error('Failed to save knowledge graph:', error as Error)
      throw error
    } finally {
      release()
    }
  }

  // Helper to consistently serialize relations for Set storage
  private _serializeRelation(relation: Relation): string {
    // Simple serialization, ensure order doesn't matter if properties are consistent
    return JSON.stringify({ from: relation.from, to: relation.to, relationType: relation.relationType })
  }

  // Helper to deserialize relations from Set storage
  private _deserializeRelation(relationStr: string): Relation {
    return JSON.parse(relationStr) as Relation
  }

  @TraceMethod({ spanName: 'createEntities', tag: 'KnowledgeGraph' })
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const newEntities: Entity[] = []
    entities.forEach((entity) => {
      if (!this.entities.has(entity.name)) {
        // Ensure observations is always an array
        const newEntity = { ...entity, observations: Array.isArray(entity.observations) ? entity.observations : [] }
        this.entities.set(entity.name, newEntity)
        newEntities.push(newEntity)
      }
    })
    if (newEntities.length > 0) {
      await this._persistGraph()
    }
    return newEntities
  }

  @TraceMethod({ spanName: 'createRelations', tag: 'KnowledgeGraph' })
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const newRelations: Relation[] = []
    relations.forEach((relation) => {
      // Ensure related entities exist before creating a relation
      if (!this.entities.has(relation.from) || !this.entities.has(relation.to)) {
        logger.warn(`Skipping relation creation: Entity not found for relation ${relation.from} -> ${relation.to}`)
        return // Skip this relation
      }
      const relationStr = this._serializeRelation(relation)
      if (!this.relations.has(relationStr)) {
        this.relations.add(relationStr)
        newRelations.push(relation)
      }
    })
    if (newRelations.length > 0) {
      await this._persistGraph()
    }
    return newRelations
  }

  @TraceMethod({ spanName: 'addObservtions', tag: 'KnowledgeGraph' })
  async addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const results: { entityName: string; addedObservations: string[] }[] = []
    let changed = false
    observations.forEach((o) => {
      const entity = this.entities.get(o.entityName)
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`)
      }
      // Ensure observations array exists
      if (!Array.isArray(entity.observations)) {
        entity.observations = []
      }
      const newObservations = o.contents.filter((content) => !entity.observations.includes(content))
      if (newObservations.length > 0) {
        entity.observations.push(...newObservations)
        results.push({ entityName: o.entityName, addedObservations: newObservations })
        changed = true
      } else {
        // Still include in results even if nothing was added, to confirm processing
        results.push({ entityName: o.entityName, addedObservations: [] })
      }
    })
    if (changed) {
      await this._persistGraph()
    }
    return results
  }

  @TraceMethod({ spanName: 'deleteEntities', tag: 'KnowledgeGraph' })
  async deleteEntities(entityNames: string[]): Promise<void> {
    let changed = false
    const namesToDelete = new Set(entityNames)

    // Delete entities
    namesToDelete.forEach((name) => {
      if (this.entities.delete(name)) {
        changed = true
      }
    })

    // Delete relations involving deleted entities
    const relationsToDelete = new Set<string>()
    this.relations.forEach((relStr) => {
      const rel = this._deserializeRelation(relStr)
      if (namesToDelete.has(rel.from) || namesToDelete.has(rel.to)) {
        relationsToDelete.add(relStr)
      }
    })

    relationsToDelete.forEach((relStr) => {
      if (this.relations.delete(relStr)) {
        changed = true
      }
    })

    if (changed) {
      await this._persistGraph()
    }
  }

  @TraceMethod({ spanName: 'deleteObservations', tag: 'KnowledgeGraph' })
  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    let changed = false
    deletions.forEach((d) => {
      const entity = this.entities.get(d.entityName)
      if (entity && Array.isArray(entity.observations)) {
        const initialLength = entity.observations.length
        const observationsToDelete = new Set(d.observations)
        entity.observations = entity.observations.filter((o) => !observationsToDelete.has(o))
        if (entity.observations.length !== initialLength) {
          changed = true
        }
      }
    })
    if (changed) {
      await this._persistGraph()
    }
  }

  @TraceMethod({ spanName: 'deleteRelations', tag: 'KnowledgeGraph' })
  async deleteRelations(relations: Relation[]): Promise<void> {
    let changed = false
    relations.forEach((rel) => {
      const relStr = this._serializeRelation(rel)
      if (this.relations.delete(relStr)) {
        changed = true
      }
    })
    if (changed) {
      await this._persistGraph()
    }
  }

  // Read the current state from memory
  @TraceMethod({ spanName: 'readGraph', tag: 'KnowledgeGraph' })
  async readGraph(): Promise<KnowledgeGraph> {
    // Return a deep copy to prevent external modification of the internal state
    return JSON.parse(
      JSON.stringify({
        entities: Array.from(this.entities.values()),
        relations: Array.from(this.relations).map((rStr) => this._deserializeRelation(rStr))
      })
    )
  }

  // Search operates on the in-memory graph
  @TraceMethod({ spanName: 'searchNodes', tag: 'KnowledgeGraph' })
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const lowerCaseQuery = query.toLowerCase()
    const filteredEntities = Array.from(this.entities.values()).filter(
      (e) =>
        e.name.toLowerCase().includes(lowerCaseQuery) ||
        e.entityType.toLowerCase().includes(lowerCaseQuery) ||
        (Array.isArray(e.observations) && e.observations.some((o) => o.toLowerCase().includes(lowerCaseQuery)))
    )

    const filteredEntityNames = new Set(filteredEntities.map((e) => e.name))

    const filteredRelations = Array.from(this.relations)
      .map((rStr) => this._deserializeRelation(rStr))
      .filter((r) => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to))

    return {
      entities: filteredEntities,
      relations: filteredRelations
    }
  }

  // Open operates on the in-memory graph
  @TraceMethod({ spanName: 'openNodes', tag: 'KnowledgeGraph' })
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const nameSet = new Set(names)
    const filteredEntities = Array.from(this.entities.values()).filter((e) => nameSet.has(e.name))
    const filteredEntityNames = new Set(filteredEntities.map((e) => e.name))

    const filteredRelations = Array.from(this.relations)
      .map((rStr) => this._deserializeRelation(rStr))
      .filter((r) => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to))

    return {
      entities: filteredEntities,
      relations: filteredRelations
    }
  }
}

class MemoryServer {
  // Hold the manager instance, initialized asynchronously
  private knowledgeGraphManager: KnowledgeGraphManager | null = null
  private initializationPromise: Promise<void> // To track initialization

  constructor(envPath: string = '') {
    const memoryPath = envPath
      ? path.isAbsolute(envPath)
        ? envPath
        : path.resolve(envPath) // Use path.resolve for relative paths based on CWD
      : getDefaultMemoryPath()

    // Start initialization once for the whole endpoint activation; every
    // protocol instance the endpoint creates shares this manager.
    this.initializationPromise = this._initializeManager(memoryPath)
  }

  public createServer(): McpServer {
    const server = new McpServer({
      name: 'memory-server',
      version: '1.1.0'
    })
    this.registerTools(server)
    return server
  }

  // Private async method to handle manager initialization
  private async _initializeManager(memoryPath: string): Promise<void> {
    try {
      this.knowledgeGraphManager = await KnowledgeGraphManager.create(memoryPath)
      logger.debug('KnowledgeGraphManager initialized successfully.')
    } catch (error) {
      logger.error('Failed to initialize KnowledgeGraphManager:', error as Error)
      // Server might be unusable, consider how to handle this state
      // Maybe set a flag and return errors for all tool calls?
      this.knowledgeGraphManager = null // Ensure it's null if init fails
    }
  }

  // Ensures the manager is initialized before handling tool calls
  private async _getManager(): Promise<KnowledgeGraphManager> {
    await this.initializationPromise // Wait for initialization to complete
    if (!this.knowledgeGraphManager) {
      throw new Error('Memory server failed to initialize. Cannot process requests.')
    }
    return this.knowledgeGraphManager
  }

  private registerTools(server: McpServer) {
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
      async ({ entities }) => json(await (await this._getManager()).createEntities(entities))
    )

    server.registerTool(
      'create_relations',
      {
        description:
          'Create multiple new relations between EXISTING entities. Skips existing relations or relations with non-existent entities.',
        inputSchema: z.object({ relations: z.array(RelationSchema) })
      },
      async ({ relations }) => json(await (await this._getManager()).createRelations(relations))
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
      async ({ observations }) => json(await (await this._getManager()).addObservations(observations))
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
        await (await this._getManager()).deleteEntities(entityNames)
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
        await (await this._getManager()).deleteObservations(deletions)
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
        await (await this._getManager()).deleteRelations(relations)
        return text('Relations deleted successfully')
      }
    )

    server.registerTool('read_graph', { description: 'Read the entire knowledge graph from memory.' }, async () =>
      json(await (await this._getManager()).readGraph())
    )

    server.registerTool(
      'search_nodes',
      {
        description: 'Search nodes (entities and relations) in memory based on a query.',
        inputSchema: z.object({
          query: z.string().describe('The search query to match against entity names, types, and observation content')
        })
      },
      async ({ query }) => json(await (await this._getManager()).searchNodes(query))
    )

    server.registerTool(
      'open_nodes',
      {
        description: 'Retrieve specific entities and their connecting relations from memory by name.',
        inputSchema: z.object({
          names: z.array(z.string()).describe('An array of entity names to retrieve')
        })
      },
      async ({ names }) => json(await (await this._getManager()).openNodes(names))
    )
  }
}

export default MemoryServer

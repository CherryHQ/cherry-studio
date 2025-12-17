import { loggerService } from '@logger'
import { getConfigDir } from '@main/utils/file'
import { TraceMethod } from '@mcp-trace/trace-core'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { Mutex } from 'async-mutex' // 引入 Mutex
import { promises as fs } from 'fs'
import path from 'path'

const logger = loggerService.withContext('MCPServer:Memory')

// Define memory file path
const defaultMemoryPath = path.join(getConfigDir(), 'memory.json')

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
      // Propagate the error or handle it more gracefully depending on requirements
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to ensure memory path: ${error instanceof Error ? error.message : String(error)}`
      )
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
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to load graph: ${error instanceof Error ? error.message : String(error)}`
        )
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
      // Decide how to handle write errors - potentially retry or notify
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to save graph: ${error instanceof Error ? error.message : String(error)}`
      )
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
        // Option 1: Throw error
        throw new McpError(ErrorCode.InvalidParams, `Entity with name ${o.entityName} not found`)
        // Option 2: Skip and warn
        // logger.warn(`Entity with name ${o.entityName} not found when adding observations. Skipping.`);
        // return;
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
  public server: Server
  // Hold the manager instance, initialized asynchronously
  private knowledgeGraphManager: KnowledgeGraphManager | null = null
  private initializationPromise: Promise<void> // To track initialization

  constructor(envPath: string = '') {
    const memoryPath = envPath
      ? path.isAbsolute(envPath)
        ? envPath
        : path.resolve(envPath) // Use path.resolve for relative paths based on CWD
      : defaultMemoryPath

    this.server = new Server(
      {
        name: 'memory-server',
        version: '1.1.0' // Incremented version for changes
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    // Start initialization, but don't block constructor
    this.initializationPromise = this._initializeManager(memoryPath)
    this.setupRequestHandlers() // Setup handlers immediately
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
      throw new McpError(ErrorCode.InternalError, 'Memory server failed to initialize. Cannot process requests.')
    }
    return this.knowledgeGraphManager
  }

  // Setup handlers (can be called from constructor)
  setupRequestHandlers() {
    // ListTools remains largely the same, descriptions might be updated if needed
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Ensure manager is ready before listing tools that depend on it
      // Although ListTools itself doesn't *call* the manager, it implies the
      // manager is ready to handle calls for those tools.
      try {
        await this._getManager() // Wait for initialization before confirming tools are available
      } catch (error) {
        // If manager failed to init, maybe return an empty tool list or throw?
        logger.error('Cannot list tools, manager initialization failed:', error as Error)
        return { tools: [] } // Return empty list if server is not ready
      }

      return {
        tools: [
          {
            name: 'create_entities',
            description: 'Create multiple new entities in the knowledge graph. Skips existing entities.',
            inputSchema: {
              type: 'object',
              properties: {
                entities: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'The name of the entity' },
                      entityType: { type: 'string', description: 'The type of the entity' },
                      observations: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'An array of observation contents associated with the entity',
                        default: [] // Add default empty array
                      }
                    },
                    required: ['name', 'entityType'] // Observations are optional now on creation
                  }
                }
              },
              required: ['entities']
            }
          },
          {
            name: 'create_relations',
            description:
              'Create multiple new relations between EXISTING entities. Skips existing relations or relations with non-existent entities.',
            inputSchema: {
              type: 'object',
              properties: {
                relations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      from: { type: 'string', description: 'The name of the entity where the relation starts' },
                      to: { type: 'string', description: 'The name of the entity where the relation ends' },
                      relationType: { type: 'string', description: 'The type of the relation' }
                    },
                    required: ['from', 'to', 'relationType']
                  }
                }
              },
              required: ['relations']
            }
          },
          {
            name: 'add_observations',
            description: 'Add new observations to existing entities. Skips duplicate observations.',
            inputSchema: {
              type: 'object',
              properties: {
                observations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      entityName: { type: 'string', description: 'The name of the entity to add the observations to' },
                      contents: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'An array of observation contents to add'
                      }
                    },
                    required: ['entityName', 'contents']
                  }
                }
              },
              required: ['observations']
            }
          },
          {
            name: 'delete_entities',
            description: 'Delete multiple entities and their associated relations.',
            inputSchema: {
              type: 'object',
              properties: {
                entityNames: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'An array of entity names to delete'
                }
              },
              required: ['entityNames']
            }
          },
          {
            name: 'delete_observations',
            description: 'Delete specific observations from entities.',
            inputSchema: {
              type: 'object',
              properties: {
                deletions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      entityName: { type: 'string', description: 'The name of the entity containing the observations' },
                      observations: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'An array of observations to delete'
                      }
                    },
                    required: ['entityName', 'observations']
                  }
                }
              },
              required: ['deletions']
            }
          },
          {
            name: 'delete_relations',
            description: 'Delete multiple specific relations.',
            inputSchema: {
              type: 'object',
              properties: {
                relations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      from: { type: 'string', description: 'The name of the entity where the relation starts' },
                      to: { type: 'string', description: 'The name of the entity where the relation ends' },
                      relationType: { type: 'string', description: 'The type of the relation' }
                    },
                    required: ['from', 'to', 'relationType']
                  },
                  description: 'An array of relations to delete'
                }
              },
              required: ['relations']
            }
          },
          {
            name: 'read_graph',
            description: 'Read the entire knowledge graph from memory.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'search_nodes',
            description: 'Search nodes (entities and relations) in memory based on a query.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query to match against entity names, types, and observation content'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'open_nodes',
            description: 'Retrieve specific entities and their connecting relations from memory by name.',
            inputSchema: {
              type: 'object',
              properties: {
                names: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'An array of entity names to retrieve'
                }
              },
              required: ['names']
            }
          }
        ]
      }
    })

    // CallTool handler needs to await the manager and the async methods
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const manager = await this._getManager() // Ensure manager is ready
      const { name, arguments: args } = request.params

      if (!args) {
        // Use McpError for standard errors
        throw new McpError(ErrorCode.InvalidParams, `No arguments provided for tool: ${name}`)
      }

      try {
        switch (name) {
          case 'create_entities':
            // Validate args structure if necessary, though SDK might do basic validation
            if (!args.entities || !Array.isArray(args.entities)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid arguments for ${name}: 'entities' array is required.`
              )
            }
            return {
              content: [
                { type: 'text', text: JSON.stringify(await manager.createEntities(args.entities as Entity[]), null, 2) }
              ]
            }
          case 'create_relations':
            if (!args.relations || !Array.isArray(args.relations)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid arguments for ${name}: 'relations' array is required.`
              )
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(await manager.createRelations(args.relations as Relation[]), null, 2)
                }
              ]
            }
          case 'add_observations':
            if (!args.observations || !Array.isArray(args.observations)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid arguments for ${name}: 'observations' array is required.`
              )
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    await manager.addObservations(args.observations as { entityName: string; contents: string[] }[]),
                    null,
                    2
                  )
                }
              ]
            }
          case 'delete_entities':
            if (!args.entityNames || !Array.isArray(args.entityNames)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid arguments for ${name}: 'entityNames' array is required.`
              )
            }
            await manager.deleteEntities(args.entityNames as string[])
            return { content: [{ type: 'text', text: 'Entities deleted successfully' }] }
          case 'delete_observations':
            if (!args.deletions || !Array.isArray(args.deletions)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid arguments for ${name}: 'deletions' array is required.`
              )
            }
            await manager.deleteObservations(args.deletions as { entityName: string; observations: string[] }[])
            return { content: [{ type: 'text', text: 'Observations deleted successfully' }] }
          case 'delete_relations':
            if (!args.relations || !Array.isArray(args.relations)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid arguments for ${name}: 'relations' array is required.`
              )
            }
            await manager.deleteRelations(args.relations as Relation[])
            return { content: [{ type: 'text', text: 'Relations deleted successfully' }] }
          case 'read_graph':
            // No arguments expected or needed for read_graph based on original schema
            return {
              content: [{ type: 'text', text: JSON.stringify(await manager.readGraph(), null, 2) }]
            }
          case 'search_nodes':
            if (typeof args.query !== 'string') {
              throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: 'query' string is required.`)
            }
            return {
              content: [
                { type: 'text', text: JSON.stringify(await manager.searchNodes(args.query as string), null, 2) }
              ]
            }
          case 'open_nodes':
            if (!args.names || !Array.isArray(args.names)) {
              throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: 'names' array is required.`)
            }
            return {
              content: [
                { type: 'text', text: JSON.stringify(await manager.openNodes(args.names as string[]), null, 2) }
              ]
            }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
        }
      } catch (error) {
        // Catch errors from manager methods (like entity not found) or other issues
        if (error instanceof McpError) {
          throw error // Re-throw McpErrors directly
        }
        logger.error(`Error executing tool ${name}:`, error as Error)
        // Throw a generic internal error for unexpected issues
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
  }
}

export default MemoryServer

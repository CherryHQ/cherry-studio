/**
 * SQL queries for MemoryService
 * All SQL queries are centralized here for better maintainability
 */

export const MemoryQueries = {
  // Table creation queries
  createTables: {
    memories: `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        memory TEXT NOT NULL,
        hash TEXT UNIQUE,
        embedding F32_BLOB(1536), -- Native vector column (1536 dimensions for OpenAI embeddings)
        metadata TEXT, -- JSON string
        user_id TEXT,
        agent_id TEXT,
        run_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0
      )
    `,

    memoryHistory: `
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        action TEXT NOT NULL, -- ADD, UPDATE, DELETE
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0,
        FOREIGN KEY (memory_id) REFERENCES memories (id)
      )
    `
  },

  // Index creation queries
  createIndexes: {
    userId: 'CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)',
    agentId: 'CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id)',
    createdAt: 'CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)',
    hash: 'CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(hash)',
    memoryHistory: 'CREATE INDEX IF NOT EXISTS idx_memory_history_memory_id ON memory_history(memory_id)',
    vector: 'CREATE INDEX IF NOT EXISTS idx_memories_vector ON memories (libsql_vector_idx(embedding))'
  },

  // Memory operations
  memory: {
    checkExists: 'SELECT id FROM memories WHERE hash = ? AND is_deleted = 0',

    checkExistsIncludeDeleted: 'SELECT id, is_deleted FROM memories WHERE hash = ?',

    restoreDeleted: `
      UPDATE memories 
      SET is_deleted = 0, memory = ?, embedding = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `,

    insert: `
      INSERT INTO memories (id, memory, hash, embedding, metadata, user_id, agent_id, run_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,

    getForDelete: 'SELECT memory FROM memories WHERE id = ? AND is_deleted = 0',

    softDelete: 'UPDATE memories SET is_deleted = 1, updated_at = ? WHERE id = ?',

    getForUpdate: 'SELECT memory, metadata FROM memories WHERE id = ? AND is_deleted = 0',

    update: `
      UPDATE memories 
      SET memory = ?, hash = ?, embedding = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `,

    count: 'SELECT COUNT(*) as total FROM memories m WHERE',

    list: `
      SELECT 
        m.id,
        m.memory,
        m.hash,
        m.metadata,
        m.user_id,
        m.agent_id,
        m.run_id,
        m.created_at,
        m.updated_at
      FROM memories m
      WHERE
    `
  },

  // History operations
  history: {
    insert: `
      INSERT INTO memory_history (memory_id, previous_value, new_value, action, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,

    getByMemoryId: `
      SELECT * FROM memory_history 
      WHERE memory_id = ? AND is_deleted = 0
      ORDER BY created_at DESC
    `
  },

  // Search operations
  search: {
    hybridSearch: `
      SELECT * FROM (
        SELECT 
          m.id,
          m.memory,
          m.hash,
          m.metadata,
          m.user_id,
          m.agent_id,
          m.run_id,
          m.created_at,
          m.updated_at,
          CASE 
            WHEN m.embedding IS NULL THEN 2.0
            ELSE vector_distance_cos(m.embedding, vector32(?))
          END as distance,
          CASE 
            WHEN m.embedding IS NULL THEN 0.0
            ELSE (1 - vector_distance_cos(m.embedding, vector32(?)))
          END as vector_similarity,
          0.0 as text_similarity,
          (
            CASE 
              WHEN m.embedding IS NULL THEN 0.0
              ELSE (1 - vector_distance_cos(m.embedding, vector32(?)))
            END
          ) as combined_score
        FROM memories m
        WHERE
    `
  },

  // User operations
  users: {
    getUniqueUsers: `
      SELECT DISTINCT 
        user_id,
        COUNT(*) as memory_count,
        MAX(created_at) as last_memory_date
      FROM memories 
      WHERE user_id IS NOT NULL AND is_deleted = 0
      GROUP BY user_id
      ORDER BY last_memory_date DESC
    `,

    countMemoriesForUser: 'SELECT COUNT(*) as total FROM memories WHERE user_id = ?',

    deleteAllMemoriesForUser: 'DELETE FROM memories WHERE user_id = ?',

    deleteHistoryForUser: 'DELETE FROM memory_history WHERE memory_id IN (SELECT id FROM memories WHERE user_id = ?)'
  }
} as const

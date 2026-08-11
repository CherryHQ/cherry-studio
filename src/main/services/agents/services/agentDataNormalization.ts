export interface AgentDataRow {
  id: string
  created_at: string
  updated_at: string
  mcps: string | null
}

export type AgentDataRepairSnapshot = Pick<AgentDataRow, 'created_at' | 'updated_at' | 'mcps'>
export type AgentDataRepairUpdate = Partial<AgentDataRepairSnapshot>

export interface AgentDataRepair {
  id: string
  original: AgentDataRepairSnapshot
  updates: AgentDataRepairUpdate
}

export interface AgentDataNormalizationResult<TRow extends AgentDataRow> {
  normalizedRow: TRow
  repair: AgentDataRepair | null
}

const EPOCH_TIMESTAMP_PATTERN = /^(\d{10}|\d{13})Z?$/i

const createRepairSnapshot = (row: AgentDataRow): AgentDataRepairSnapshot => ({
  created_at: row.created_at,
  updated_at: row.updated_at,
  mcps: row.mcps
})

const normalizeAgentTimestampValue = (value: string): string | null => {
  const trimmedValue = value.trim()
  const epochMatch = EPOCH_TIMESTAMP_PATTERN.exec(trimmedValue)
  const date = epochMatch
    ? new Date(Number(epochMatch[1]) * (epochMatch[1].length === 10 ? 1000 : 1))
    : new Date(trimmedValue)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const normalizeAgentTimestamps = <TRow extends AgentDataRow>(
  row: TRow,
  fallbackTimestamp: string
): AgentDataNormalizationResult<TRow> => {
  const normalizedCreatedAt = normalizeAgentTimestampValue(row.created_at)
  const normalizedUpdatedAt = normalizeAgentTimestampValue(row.updated_at)
  const createdAt = normalizedCreatedAt ?? normalizedUpdatedAt ?? fallbackTimestamp
  const updatedAt = normalizedUpdatedAt ?? normalizedCreatedAt ?? fallbackTimestamp
  const updates: AgentDataRepairUpdate = {}

  if (createdAt !== row.created_at) {
    updates.created_at = createdAt
  }
  if (updatedAt !== row.updated_at) {
    updates.updated_at = updatedAt
  }

  if (updates.created_at === undefined && updates.updated_at === undefined) {
    return { normalizedRow: row, repair: null }
  }

  return {
    normalizedRow: { ...row, ...updates },
    repair: {
      id: row.id,
      original: createRepairSnapshot(row),
      updates
    }
  }
}

const normalizeAgentMcps = <TRow extends AgentDataRow>(row: TRow): AgentDataNormalizationResult<TRow> => {
  if (row.mcps === null) {
    return { normalizedRow: row, repair: null }
  }

  let parsedMcps: unknown
  try {
    parsedMcps = JSON.parse(row.mcps)
  } catch {
    parsedMcps = null
  }

  if (Array.isArray(parsedMcps) && parsedMcps.every((mcpId) => typeof mcpId === 'string')) {
    return { normalizedRow: row, repair: null }
  }

  const mcps = Array.isArray(parsedMcps) ? parsedMcps.filter((mcpId): mcpId is string => typeof mcpId === 'string') : []
  const normalizedMcps = JSON.stringify(mcps)

  return {
    normalizedRow: { ...row, mcps: normalizedMcps },
    repair: {
      id: row.id,
      original: createRepairSnapshot(row),
      updates: { mcps: normalizedMcps }
    }
  }
}

export const normalizeAgentDataRow = <TRow extends AgentDataRow>(
  row: TRow,
  fallbackTimestamp: string
): AgentDataNormalizationResult<TRow> => {
  const timestampResult = normalizeAgentTimestamps(row, fallbackTimestamp)
  const mcpResult = normalizeAgentMcps(timestampResult.normalizedRow)

  if (!timestampResult.repair && !mcpResult.repair) {
    return { normalizedRow: row, repair: null }
  }

  return {
    normalizedRow: mcpResult.normalizedRow,
    repair: {
      id: row.id,
      original: createRepairSnapshot(row),
      updates: {
        ...timestampResult.repair?.updates,
        ...mcpResult.repair?.updates
      }
    }
  }
}

import { asSchema } from 'ai'

/**
 * Normalise a tool's `inputSchema` to canonical JSONSchema. Tools carry either
 * Zod or a `jsonSchema()`-wrapped schema (e.g. MCP tools); `asSchema(...).jsonSchema`
 * is the shape the model actually sees inline. Returns undefined on any failure so
 * the token estimate can fall back to the name and description.
 */
export async function serializeToolSchema(schema: unknown): Promise<unknown> {
  if (!schema) return undefined
  try {
    return await asSchema(schema as Parameters<typeof asSchema>[0]).jsonSchema
  } catch {
    return undefined
  }
}

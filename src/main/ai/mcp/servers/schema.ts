import type { Tool } from '@modelcontextprotocol/server'

/**
 * Zod's JSON Schema return type covers every possible root even when the
 * source schema is a Zod object. MCP tool inputs require an object root, so
 * narrow that library type at the wire boundary and fail closed if it changes.
 */
export function requireToolInputSchema(schema: unknown): Tool['inputSchema'] {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    (schema as { type?: unknown }).type !== 'object'
  ) {
    throw new Error('MCP tool input schema must have an object root')
  }
  return schema as Tool['inputSchema']
}

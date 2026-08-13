import { asSchema, type ToolSet } from 'ai'

/** One wire tool definition (what `countToolDefs` and the remote Anthropic count consume). */
export interface WireToolDef {
  name: string
  description?: string
  input_schema: unknown
}

/**
 * The tool definitions generation actually sends, rebuilt from a converter's `ToolSet`:
 * its keys are the normalized wire-safe names, converter-dropped declarations (name-less
 * Gemini entries, Anthropic `bash_20250124`) are absent, and each schema is the canonical
 * JSONSchema the SDK serializes from the zod conversion. Counting these instead of the raw
 * `body.tools` keeps estimates wire-equivalent — an oversize invalid name or a discarded
 * declaration's huge schema never reaches the wire, so it must not dominate the count.
 */
export async function toWireToolDefs(tools: ToolSet | undefined): Promise<WireToolDef[] | undefined> {
  if (!tools) return undefined
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: await canonicalSchema(tool.inputSchema)
    }))
  )
}

/** Canonical JSONSchema as the SDK serializes it; a minimal object schema on failure. */
async function canonicalSchema(schema: unknown): Promise<unknown> {
  try {
    return (await asSchema(schema as Parameters<typeof asSchema>[0]).jsonSchema) ?? { type: 'object' }
  } catch {
    return { type: 'object' }
  }
}

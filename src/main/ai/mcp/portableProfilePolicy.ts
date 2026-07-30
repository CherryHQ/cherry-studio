import type { McpServerRow } from '@data/db/schemas/mcpServer'
import type { PortableProfileSanitization } from '@data/portableProfilePolicy'
import { McpConfigSampleSchema } from '@shared/data/types/mcpServer'
import * as z from 'zod'

/** Reference-bearing MCP values read from an untrusted detached database. */
export interface McpServerCapabilityInput {
  readonly args: unknown
  readonly env: unknown
  readonly headers: unknown
  readonly configSample: unknown
  readonly disabledTools: unknown
  readonly disabledAutoApproveTools: unknown
}

export interface McpServerCapabilityPatch {
  readonly isActive: false
  readonly isTrusted: null
  readonly trustedAt: null
  readonly dxtPath: null
  readonly command?: null
  readonly args?: null
  readonly env?: null
  readonly baseUrl?: null
  readonly headers?: null
  readonly configSample?: null
}

export type McpServerCapabilityMalformedField = keyof McpServerCapabilityInput

export type McpServerCapabilitySanitization = PortableProfileSanitization<
  McpServerCapabilityPatch,
  McpServerCapabilityMalformedField
>

const StringArraySchema = z.array(z.string())
const StringRecordSchema = z.record(z.string(), z.string())

function matches(schema: z.ZodType, value: unknown): boolean {
  return value === null || value === undefined || schema.safeParse(value).success
}

/**
 * Preserve MCP configuration as inert data while removing every field that can
 * make it live on the target.
 *
 * A malformed known JSON field fails the executable/network capability closed.
 * Restriction lists are never cleared because doing so would widen a server if
 * the user later repairs and reactivates it.
 */
export function sanitizeMcpServerCapability(input: McpServerCapabilityInput): McpServerCapabilitySanitization {
  const malformedFields: McpServerCapabilityMalformedField[] = []
  if (!matches(StringArraySchema, input.args)) malformedFields.push('args')
  if (!matches(StringRecordSchema, input.env)) malformedFields.push('env')
  if (!matches(StringRecordSchema, input.headers)) malformedFields.push('headers')
  if (!matches(McpConfigSampleSchema, input.configSample)) malformedFields.push('configSample')
  if (!matches(StringArraySchema, input.disabledTools)) malformedFields.push('disabledTools')
  if (!matches(StringArraySchema, input.disabledAutoApproveTools)) malformedFields.push('disabledAutoApproveTools')

  const reset = {
    isActive: false,
    isTrusted: null,
    trustedAt: null,
    dxtPath: null
  } as const satisfies Readonly<Pick<McpServerRow, 'isActive' | 'isTrusted' | 'trustedAt' | 'dxtPath'>>
  if (malformedFields.length === 0) return { patch: reset, malformedFields }

  const patch = {
    ...reset,
    command: null,
    args: null,
    env: null,
    baseUrl: null,
    headers: null,
    configSample: null
  } as const satisfies Readonly<
    Pick<
      McpServerRow,
      | 'isActive'
      | 'isTrusted'
      | 'trustedAt'
      | 'dxtPath'
      | 'command'
      | 'args'
      | 'env'
      | 'baseUrl'
      | 'headers'
      | 'configSample'
    >
  >

  return {
    patch,
    malformedFields
  }
}

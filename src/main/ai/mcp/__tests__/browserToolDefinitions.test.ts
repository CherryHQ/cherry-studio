import { zodSchema } from '@ai-sdk/provider-utils'
import { describe, expect, it } from 'vitest'

import { sessionToolDefinitions } from '../browserToolDefinitions'

const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_VALUES = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else'
])

/** Gemini's Schema proto declares `enum` as a string list, so one numeric literal in a declaration
 *  fails the whole request ("Invalid value at ... (TYPE_STRING)"). */
function numericLiterals(schema: unknown, path: string, found: string[] = []): string[] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return found

  const node = schema as Record<string, unknown>
  if (typeof node.const === 'number') found.push(`${path}.const`)
  if (Array.isArray(node.enum) && node.enum.some((value) => typeof value !== 'string')) found.push(`${path}.enum`)

  for (const [key, value] of Object.entries(node)) {
    if (typeof value !== 'object' || value === null) continue
    if (SCHEMA_MAPS.has(key)) {
      for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
        numericLiterals(entry, `${path}.${key}.${name}`, found)
      }
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      value.forEach((entry, index) => numericLiterals(entry, `${path}.${key}[${index}]`, found))
    } else if (SCHEMA_VALUES.has(key)) {
      numericLiterals(value, `${path}.${key}`, found)
    }
  }
  return found
}

describe('browser tool definitions', () => {
  it('reaches every provider without a numeric const/enum literal', () => {
    const offenders = sessionToolDefinitions.flatMap(({ name, inputSchema }) =>
      numericLiterals(zodSchema(inputSchema).jsonSchema, name)
    )

    expect(offenders).toEqual([])
  })
})

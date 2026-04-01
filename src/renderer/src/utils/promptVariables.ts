/**
 * Prompt template variable utilities
 *
 * Handles extraction of ${var} placeholders from prompt content,
 * replacement with user-provided values, and variable ID generation.
 */

import type { PromptVariable } from '@shared/data/types/prompt'
import { v4 as uuidv4 } from 'uuid'

/** Regex to match ${key} template variables in prompt content */
const VARIABLE_PATTERN = /\$\{(\w+)\}/g

/**
 * Generate a unique variable ID (UUID v4).
 */
export function generateVariableId(): string {
  return uuidv4()
}

/**
 * Generate a unique default key that doesn't conflict with existing keys.
 */
export function generateDefaultKey(existingKeys: string[]): string {
  const keySet = new Set(existingKeys)
  let i = 1
  while (keySet.has(`var${i}`)) {
    i++
  }
  return `var${i}`
}

/**
 * Extract all unique variable keys from prompt content.
 * Returns keys in order of first appearance.
 */
export function extractVariableKeys(content: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()

  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const key = match[1]
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }

  return keys
}

/**
 * Check if prompt content contains any template variables.
 */
export function hasTemplateVariables(content: string): boolean {
  return /\$\{(\w+)\}/.test(content)
}

/**
 * Replace all ${key} placeholders in content with provided values.
 * Variables not present in the values map are left as-is.
 */
export function replaceTemplateVariables(content: string, values: Record<string, string>): string {
  return content.replace(VARIABLE_PATTERN, (match, key: string) => {
    return key in values ? values[key] : match
  })
}

/**
 * Replace a specific variable key in content.
 * Replaces all occurrences of ${oldKey} with ${newKey}.
 */
export function renameVariableInContent(content: string, oldKey: string, newKey: string): string {
  const pattern = new RegExp(`\\$\\{${escapeRegExp(oldKey)}\\}`, 'g')
  return content.replace(pattern, `\${${newKey}}`)
}

/**
 * Remove a specific variable placeholder from content.
 * Removes all occurrences of ${key}.
 */
export function removeVariableFromContent(content: string, key: string): string {
  const pattern = new RegExp(`\\$\\{${escapeRegExp(key)}\\}`, 'g')
  return content.replace(pattern, '')
}

/**
 * Validate that all variable keys in the variables array exist in the content.
 * Returns keys that are defined in variables but missing from content.
 */
export function findOrphanedVariableKeys(content: string, variables: PromptVariable[]): string[] {
  const contentKeys = new Set(extractVariableKeys(content))
  return variables.filter((v) => !contentKeys.has(v.key)).map((v) => v.key)
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

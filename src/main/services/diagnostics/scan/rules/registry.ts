import type { ScanRule } from '../types'
import { agentRules } from './agent'
import { chatRules } from './chat'
import { environmentRules } from './environment'
import { mcpRules } from './mcp'
import { networkRules } from './network'
import { providerRules } from './provider'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/

/** Throws on the first invalid rule. Exported so the contract itself is testable. */
export function assertValidRules(rules: readonly ScanRule[]): readonly ScanRule[] {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`Duplicate scan rule id: ${rule.id}`)
    seen.add(rule.id)
    if (!KEBAB_CASE.test(rule.id)) throw new Error(`Scan rule id must be kebab-case: ${rule.id}`)
    if (!rule.id.startsWith(`${rule.domain}-`)) {
      throw new Error(`Scan rule id must be prefixed with its domain: ${rule.id}`)
    }
    if (rule.devMessage.trim() === '') throw new Error(`Scan rule has no devMessage: ${rule.id}`)
    if (rule.anchors.length === 0) throw new Error(`Scan rule has no anchors: ${rule.id}`)
    for (const pattern of [...rule.anchors, ...(rule.exclude ?? [])]) {
      // stateful regexes (g/y) keep lastIndex across .test() calls and silently miss matches
      if (pattern.global || pattern.sticky) {
        throw new Error(`Scan rule uses a stateful regex flag: ${rule.id}`)
      }
    }
  }
  return rules
}

export const SCAN_RULES: readonly ScanRule[] = assertValidRules([
  ...providerRules,
  ...networkRules,
  ...agentRules,
  ...mcpRules,
  ...chatRules,
  ...environmentRules
])

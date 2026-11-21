import type { CSSProperties } from 'react'

export const AGENT_COLOR_COUNT = 8

// FNV-1a: stable across sessions so an agent keeps its color without any stored preference.
export function getAgentColorIndex(agentId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % AGENT_COLOR_COUNT
}

// The tint is a translucent layer, so selected and hover row fills still show through.
export function getAgentColorStyle(agentId: string | null): CSSProperties {
  if (!agentId) return {}
  const accent = `var(--agent-color-${getAgentColorIndex(agentId)})`
  const tint = `color-mix(in oklab, ${accent} 10%, transparent)`
  return {
    '--agent-accent': accent,
    backgroundImage: `linear-gradient(${tint}, ${tint})`,
    boxShadow: 'inset 3px 0 0 var(--agent-accent)'
  } as CSSProperties
}

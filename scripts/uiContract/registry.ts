import { readFile, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { stableHash } from './semanticId'
import { UI_CONTRACT_VERSION, type UiContractRegistry, type UiNodeDescriptor, type UiRegistryNode } from './types'

export const UI_CONTRACT_REGISTRY_PATH = 'ui-contract.registry.json'

export function emptyRegistry(): UiContractRegistry {
  return { nodes: [], retiredIds: [], version: UI_CONTRACT_VERSION }
}

export async function readRegistry(root: string): Promise<UiContractRegistry> {
  try {
    const value = JSON.parse(await readFile(resolve(root, UI_CONTRACT_REGISTRY_PATH), 'utf8')) as UiContractRegistry
    if (value.version !== UI_CONTRACT_VERSION || !Array.isArray(value.nodes) || !Array.isArray(value.retiredIds)) {
      throw new Error(`Unsupported UI contract registry format at ${UI_CONTRACT_REGISTRY_PATH}`)
    }
    return canonicalizeRegistry(value)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
    throw error
  }
}

function allocateId(descriptor: UiNodeDescriptor, usedIds: Set<string>): string {
  for (let length = 7; length <= descriptor.anchorHash.length; length += 1) {
    const candidate = `u${descriptor.anchorHash.slice(0, length)}`
    if (!usedIds.has(candidate)) return candidate
  }
  return `u${stableHash(`${descriptor.anchorHash}:${usedIds.size}`, 24)}`
}

export function reconcileRegistry(previous: UiContractRegistry, descriptors: UiNodeDescriptor[]): UiContractRegistry {
  const oldByAnchor = new Map(previous.nodes.map((node) => [node[0], node]))
  const sorted = [...descriptors].sort((left, right) => left.anchorHash.localeCompare(right.anchorHash))

  const usedOldIds = new Set<string>()
  const matches = new Map<UiNodeDescriptor, { id: string; semanticId: string }>()
  for (const descriptor of sorted) {
    const candidates = [
      oldByAnchor.get(descriptor.anchorHash),
      descriptor.previousAnchorHash ? oldByAnchor.get(descriptor.previousAnchorHash) : undefined
    ]
    const matched = candidates.find((node) => node && !usedOldIds.has(node[2]))
    if (!matched) continue
    usedOldIds.add(matched[2])
    matches.set(descriptor, {
      id: matched[2],
      semanticId: descriptor.semanticSource === 'explicit' ? descriptor.semanticId : matched[3]
    })
  }

  // Fingerprint fallback: an ID follows a structural twin only when the pairing is
  // unambiguous — exactly one departed and one arrived node share the fingerprint —
  // and an explicit semantic does not contradict the previous identity. Unlike a
  // Git-confirmed move, this match is presumed, so the node re-presents its current
  // semantic instead of inheriting a possibly stale one.
  const departedByFingerprint = new Map<string, UiRegistryNode[]>()
  for (const node of previous.nodes) {
    if (usedOldIds.has(node[2])) continue
    departedByFingerprint.set(node[1], [...(departedByFingerprint.get(node[1]) ?? []), node])
  }
  const arrivedByFingerprint = new Map<string, UiNodeDescriptor[]>()
  for (const descriptor of sorted) {
    if (matches.has(descriptor)) continue
    const arrived = arrivedByFingerprint.get(descriptor.fingerprintHash) ?? []
    arrivedByFingerprint.set(descriptor.fingerprintHash, [...arrived, descriptor])
  }
  for (const [fingerprint, arrived] of arrivedByFingerprint) {
    const departed = departedByFingerprint.get(fingerprint)
    if (arrived.length !== 1 || departed?.length !== 1) continue
    const [descriptor] = arrived
    const [node] = departed
    if (descriptor.semanticSource === 'explicit' && descriptor.semanticId !== node[3]) continue
    usedOldIds.add(node[2])
    matches.set(descriptor, { id: node[2], semanticId: descriptor.semanticId })
  }

  const usedIds = new Set([...previous.retiredIds, ...previous.nodes.map((node) => node[2])])
  const nodes = sorted.map((descriptor): UiRegistryNode => {
    const matched = matches.get(descriptor)
    if (matched) return [descriptor.anchorHash, descriptor.fingerprintHash, matched.id, matched.semanticId]
    const id = allocateId(descriptor, usedIds)
    usedIds.add(id)
    return [descriptor.anchorHash, descriptor.fingerprintHash, id, descriptor.semanticId]
  })

  const retiredIds = new Set(previous.retiredIds)
  for (const node of previous.nodes) {
    if (!usedOldIds.has(node[2])) retiredIds.add(node[2])
  }

  return canonicalizeRegistry({ nodes, retiredIds: [...retiredIds], version: UI_CONTRACT_VERSION })
}

export function canonicalizeRegistry(registry: UiContractRegistry): UiContractRegistry {
  return {
    nodes: [...registry.nodes].sort((left, right) => left[0].localeCompare(right[0])),
    retiredIds: [...new Set(registry.retiredIds)].sort(),
    version: UI_CONTRACT_VERSION
  }
}

export function serializeRegistry(registry: UiContractRegistry): string {
  const canonical = canonicalizeRegistry(registry)
  const nodes = canonical.nodes.map((node) => `    ${JSON.stringify(node)}`).join(',\n')
  return [
    '{',
    `  "version": ${canonical.version},`,
    '  "nodes": [',
    nodes,
    '  ],',
    `  "retiredIds": ${JSON.stringify(canonical.retiredIds)}`,
    '}',
    ''
  ].join('\n')
}

export async function writeRegistry(root: string, registry: UiContractRegistry): Promise<void> {
  const path = resolve(root, UI_CONTRACT_REGISTRY_PATH)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeRegistry(registry), 'utf8')
}

export function registryNodeMap(registry: UiContractRegistry): Map<string, { id: string; semanticId: string }> {
  return new Map(registry.nodes.map((node) => [node[0], { id: node[2], semanticId: node[3] }]))
}

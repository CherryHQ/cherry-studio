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
  const oldByFingerprint = new Map<string, UiRegistryNode[]>()
  const newFingerprintCounts = new Map<string, number>()

  for (const node of previous.nodes) {
    const matches = oldByFingerprint.get(node[1]) ?? []
    matches.push(node)
    oldByFingerprint.set(node[1], matches)
  }
  for (const descriptor of descriptors) {
    newFingerprintCounts.set(
      descriptor.fingerprintHash,
      (newFingerprintCounts.get(descriptor.fingerprintHash) ?? 0) + 1
    )
  }

  const usedOldIds = new Set<string>()
  const usedIds = new Set([...previous.retiredIds, ...previous.nodes.map((node) => node[2])])
  const nodes = [...descriptors]
    .sort((left, right) => left.anchorHash.localeCompare(right.anchorHash))
    .map((descriptor): UiRegistryNode => {
      const exact = oldByAnchor.get(descriptor.anchorHash)
      if (exact && !usedOldIds.has(exact[2])) {
        usedOldIds.add(exact[2])
        return [
          descriptor.anchorHash,
          descriptor.fingerprintHash,
          exact[2],
          descriptor.semanticSource === 'explicit' ? descriptor.semanticId : exact[3]
        ]
      }

      const fingerprintMatches = oldByFingerprint.get(descriptor.fingerprintHash) ?? []
      const movable =
        fingerprintMatches.length === 1 && newFingerprintCounts.get(descriptor.fingerprintHash) === 1
          ? fingerprintMatches[0]
          : undefined
      if (movable && !usedOldIds.has(movable[2])) {
        usedOldIds.add(movable[2])
        return [
          descriptor.anchorHash,
          descriptor.fingerprintHash,
          movable[2],
          descriptor.semanticSource === 'explicit' ? descriptor.semanticId : movable[3]
        ]
      }

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

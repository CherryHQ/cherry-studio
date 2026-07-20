import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { uiNodeId } from './semanticId'
import { UI_CONTRACT_VERSION, type UiContractRegistry, type UiNodeDescriptor, type UiRegistryNode } from './types'

export const UI_CONTRACT_REGISTRY_PATH = 'ui-contract.registry.json'

export function emptyRegistry(): UiContractRegistry {
  return { nodes: [], version: UI_CONTRACT_VERSION }
}

function isRegistryNode(value: unknown): value is UiRegistryNode {
  return Array.isArray(value) && value.length === 3 && value.every((field) => typeof field === 'string')
}

export async function readRegistry(root: string): Promise<UiContractRegistry> {
  try {
    const value = JSON.parse(
      await readFile(resolve(root, UI_CONTRACT_REGISTRY_PATH), 'utf8')
    ) as Partial<UiContractRegistry>
    if (value.version !== UI_CONTRACT_VERSION || !Array.isArray(value.nodes) || !value.nodes.every(isRegistryNode)) {
      throw new Error(`Unsupported UI contract registry format at ${UI_CONTRACT_REGISTRY_PATH}`)
    }
    return canonicalizeRegistry({ nodes: value.nodes, version: value.version })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
    throw error
  }
}

function allocateId(descriptor: UiNodeDescriptor, usedIds: Set<string>): string {
  const id = uiNodeId(descriptor.anchorHash)
  if (usedIds.has(id)) {
    throw new Error(`UI node ID collision for ${id}; change the 64-bit ID scheme before syncing the registry`)
  }
  return id
}

export function reconcileRegistry(previous: UiContractRegistry, descriptors: UiNodeDescriptor[]): UiContractRegistry {
  const oldByAnchor = new Map(previous.nodes.map((node) => [node[0], node]))
  const sorted = [...descriptors].sort((left, right) => left.anchorHash.localeCompare(right.anchorHash))
  const usedOldIds = new Set<string>()
  const matches = new Map<UiNodeDescriptor, string>()

  for (const descriptor of sorted) {
    const candidates = [
      oldByAnchor.get(descriptor.anchorHash),
      descriptor.previousAnchorHash ? oldByAnchor.get(descriptor.previousAnchorHash) : undefined
    ]
    const matched = candidates.find((node) => node && !usedOldIds.has(node[2]))
    if (!matched) continue
    usedOldIds.add(matched[2])
    matches.set(descriptor, matched[2])
  }

  // Preserve identity across structural moves only when exactly one departed
  // and one arrived node share the same DOM fingerprint. Explicit semantic IDs
  // are part of that fingerprint, so changing one cannot inherit the old ID.
  const departedByFingerprint = new Map<string, UiRegistryNode[]>()
  for (const node of previous.nodes) {
    if (usedOldIds.has(node[2])) continue
    departedByFingerprint.set(node[1], [...(departedByFingerprint.get(node[1]) ?? []), node])
  }
  const arrivedByFingerprint = new Map<string, UiNodeDescriptor[]>()
  for (const descriptor of sorted) {
    if (matches.has(descriptor)) continue
    arrivedByFingerprint.set(descriptor.fingerprintHash, [
      ...(arrivedByFingerprint.get(descriptor.fingerprintHash) ?? []),
      descriptor
    ])
  }
  for (const [fingerprint, arrived] of arrivedByFingerprint) {
    const departed = departedByFingerprint.get(fingerprint)
    if (arrived.length !== 1 || departed?.length !== 1) continue
    const [descriptor] = arrived
    const [node] = departed
    usedOldIds.add(node[2])
    matches.set(descriptor, node[2])
  }

  const usedIds = new Set(previous.nodes.map((node) => node[2]))
  const nodes = sorted.map((descriptor): UiRegistryNode => {
    const matchedId = matches.get(descriptor)
    if (matchedId) return [descriptor.anchorHash, descriptor.fingerprintHash, matchedId]
    const id = allocateId(descriptor, usedIds)
    usedIds.add(id)
    return [descriptor.anchorHash, descriptor.fingerprintHash, id]
  })

  return canonicalizeRegistry({ nodes, version: UI_CONTRACT_VERSION })
}

export function canonicalizeRegistry(registry: UiContractRegistry): UiContractRegistry {
  const nodes = [...registry.nodes].sort((left, right) => left[0].localeCompare(right[0]))
  const anchors = new Set<string>()
  const ids = new Set<string>()
  for (const node of nodes) {
    if (anchors.has(node[0])) throw new Error(`Duplicate UI registry anchor: ${node[0]}`)
    if (ids.has(node[2])) throw new Error(`Duplicate UI registry ID: ${node[2]}`)
    anchors.add(node[0])
    ids.add(node[2])
  }
  return { nodes, version: UI_CONTRACT_VERSION }
}

export function serializeRegistry(registry: UiContractRegistry): string {
  const canonical = canonicalizeRegistry(registry)
  const nodes = canonical.nodes.map((node) => `    ${JSON.stringify(node)}`).join(',\n')
  return ['{', `  "version": ${canonical.version},`, '  "nodes": [', nodes, '  ]', '}', ''].join('\n')
}

export async function writeRegistry(root: string, registry: UiContractRegistry): Promise<void> {
  const path = resolve(root, UI_CONTRACT_REGISTRY_PATH)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeRegistry(registry), 'utf8')
}

export function registryIdMap(registry: UiContractRegistry): Map<string, string> {
  return new Map(registry.nodes.map((node) => [node[0], node[2]]))
}

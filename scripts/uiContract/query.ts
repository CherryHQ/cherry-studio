import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readRegistry, reconcileRegistry, registryIdMap, serializeRegistry } from './registry'
import { scanUiSources } from './scan'
import { assertUniqueUiNodeIds } from './semanticId'
import type { UiNodeDescriptor } from './types'

type UiContractQueryNode = Pick<
  UiNodeDescriptor,
  'component' | 'element' | 'kind' | 'semanticId' | 'sourceFile' | 'sourceOffset'
> & { id: string }

async function main(): Promise<void> {
  const query = process.argv.slice(2).find((argument) => !argument.startsWith('-'))
  if (!query) {
    process.stderr.write('Usage: pnpm ui:contract:query <semantic-prefix>\n')
    process.exitCode = 1
    return
  }

  const root = resolve(process.cwd())
  const registry = await readRegistry(root)
  const descriptors = await scanUiSources(root)
  const reconciled = reconcileRegistry(registry, descriptors)
  if (serializeRegistry(registry) !== serializeRegistry(reconciled)) {
    process.stderr.write('UI contract registry is stale. Run `pnpm ui:contract:sync`.\n')
    process.exitCode = 1
    return
  }

  const idByAnchor = registryIdMap(registry)
  const nodes = descriptors.flatMap((descriptor): UiContractQueryNode[] => {
    const id = idByAnchor.get(descriptor.anchorHash)
    return id
      ? [
          {
            component: descriptor.component,
            element: descriptor.element,
            id,
            kind: descriptor.kind,
            semanticId: descriptor.semanticId,
            sourceFile: descriptor.sourceFile,
            sourceOffset: descriptor.sourceOffset
          }
        ]
      : []
  })
  assertUniqueUiNodeIds(nodes)
  const matches = nodes
    .filter((node) => node.semanticId === query || node.semanticId.startsWith(`${query}.`))
    .sort((left, right) => left.id.localeCompare(right.id))

  const sourceByFile = new Map<string, Promise<string>>()
  const output = await Promise.all(
    matches.map(async (node) => {
      const sourcePromise = sourceByFile.get(node.sourceFile) ?? readFile(resolve(root, node.sourceFile), 'utf8')
      sourceByFile.set(node.sourceFile, sourcePromise)
      const beforeNode = (await sourcePromise).slice(0, node.sourceOffset)
      const lines = beforeNode.split('\n')
      return { ...node, column: (lines.at(-1)?.length ?? 0) + 1, line: lines.length }
    })
  )

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

void main()

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { scanUiSources } from './scan'
import { assertUniqueUiNodeIds, uiContractForDescriptor } from './semanticId'
import type { UiContractManifestNode } from './types'

async function main(): Promise<void> {
  const query = process.argv.slice(2).find((argument) => !argument.startsWith('-'))
  if (!query) {
    process.stderr.write('Usage: pnpm ui:contract:query <semantic-prefix>\n')
    process.exitCode = 1
    return
  }

  const root = resolve(process.cwd())
  const descriptors = await scanUiSources(root)
  assertUniqueUiNodeIds(descriptors)

  const matches = descriptors
    .flatMap((descriptor): UiContractManifestNode[] => {
      const node = { ...descriptor, ...uiContractForDescriptor(descriptor) }
      return node.semanticId === query || node.semanticId.startsWith(`${query}.`) ? [node] : []
    })
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

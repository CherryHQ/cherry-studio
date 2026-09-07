import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { scanUiSources } from './scan'
import type { UiNodeDescriptor } from './types'

type UiContractQueryNode = Pick<
  UiNodeDescriptor,
  'component' | 'element' | 'kind' | 'semanticId' | 'sourceFile' | 'sourceOffset'
>

async function main(): Promise<void> {
  const query = process.argv.slice(2).find((argument) => !argument.startsWith('-'))
  if (!query) {
    process.stderr.write('Usage: pnpm ui:contract:query <semantic-prefix>\n')
    process.exitCode = 1
    return
  }

  const root = resolve(process.cwd())
  const descriptors = await scanUiSources(root)
  const matches = descriptors
    .filter((node) => node.semanticId === query || node.semanticId.startsWith(`${query}.`))
    .sort(
      (left, right) =>
        left.semanticId.localeCompare(right.semanticId) ||
        left.sourceFile.localeCompare(right.sourceFile) ||
        left.sourceOffset - right.sourceOffset
    )

  const sourceByFile = new Map<string, Promise<string>>()
  const output = await Promise.all(
    matches.map(async (node) => {
      const sourcePromise = sourceByFile.get(node.sourceFile) ?? readFile(resolve(root, node.sourceFile), 'utf8')
      sourceByFile.set(node.sourceFile, sourcePromise)
      const beforeNode = (await sourcePromise).slice(0, node.sourceOffset)
      const lines = beforeNode.split('\n')
      const result: UiContractQueryNode & { column: number; line: number } = {
        component: node.component,
        element: node.element,
        kind: node.kind,
        semanticId: node.semanticId,
        sourceFile: node.sourceFile,
        sourceOffset: node.sourceOffset,
        column: (lines.at(-1)?.length ?? 0) + 1,
        line: lines.length
      }
      return result
    })
  )

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

void main()

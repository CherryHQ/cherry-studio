import { resolve } from 'node:path'

import { readRegistry, reconcileRegistry, serializeRegistry, writeRegistry } from './registry'
import { scanUiSources } from './scan'

async function main(): Promise<void> {
  const root = resolve(process.cwd())
  const checkOnly = process.argv.includes('--check')
  const previous = await readRegistry(root)
  const descriptors = await scanUiSources(root)
  const next = reconcileRegistry(previous, descriptors)

  if (serializeRegistry(previous) === serializeRegistry(next)) {
    process.stdout.write(`UI contract registry is current (${next.nodes.length} nodes).\n`)
  } else if (checkOnly) {
    process.stderr.write('UI contract registry is stale. Run `pnpm ui:contract:sync`.\n')
    process.exitCode = 1
  } else {
    await writeRegistry(root, next)
    process.stdout.write(
      `Updated UI contract registry (${next.nodes.length} active nodes, ${next.retiredIds.length} retired IDs).\n`
    )
  }
}

void main()

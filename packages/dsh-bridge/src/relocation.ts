import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

/** Recreate native records without changing event or session identities. */
export async function stageRelocatedSessions(input: {
  sourceRoot: string
  targetRoot: string
  oldCwd: string
  newCwd: string
}): Promise<Array<{ id: string; source: string; target: string }>> {
  const source = new Context()
  const target = new Context()
  try {
    await source.plugin(SessionStore)
    await source.plugin(JsonlSessionPersistence, { root: input.sourceRoot })
    await target.plugin(SessionStore)
    await target.plugin(JsonlSessionPersistence, { root: input.targetRoot })
    const result: Array<{ id: string; source: string; target: string }> = []
    const sourceFiles = await readdir(input.sourceRoot, { recursive: true })
    for (const { header } of await source.sessionPersistence.list()) {
      if (!header.cwd || path.relative(header.cwd, input.oldCwd) !== '') continue
      const reader = await source.sessionPersistence.open(header.id, 'read')
      try {
        const { events } = await reader.read()
        const relocated = { ...reader.header, cwd: input.newCwd }
        const options = { inheritedEventCount: reader.inheritedEventCount }
        const writer = await target.sessionPersistence.create(relocated, options)
        try {
          await writer.append(events)
          await writer.flush()
        } finally {
          await writer.close()
        }
        const check = await target.sessionPersistence.open(header.id, 'read')
        try {
          if (
            !isDeepStrictEqual(check.header, relocated) ||
            check.inheritedEventCount !== reader.inheritedEventCount ||
            !isDeepStrictEqual((await check.read()).events, events)
          )
            throw new Error('Relocated DSH history does not match its source')
        } finally {
          await check.close()
        }
        const directories = (files: string[]) => [
          ...new Set(
            files
              .filter((file) => path.basename(path.dirname(file)) === header.id && file.endsWith('.jsonl.zstd'))
              .map((file) => path.dirname(file))
          )
        ]
        const originals = directories(sourceFiles)
        const staged = directories(await readdir(input.targetRoot, { recursive: true }))
        if (originals.length !== 1 || staged.length !== 1) throw new Error('Unsupported DSH storage layout')
        result.push({ id: header.id, source: originals[0], target: staged[0] })
      } finally {
        await reader.close()
      }
    }
    return result
  } finally {
    await Promise.all([target.fiber.dispose(), source.fiber.dispose()])
  }
}

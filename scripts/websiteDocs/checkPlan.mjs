import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  assertCurrentPlan,
  contentTree,
  fetchRevision,
  git,
  planPath,
  repositories,
  scratch,
  sha,
  validatePlan
} from './content.mjs'
import { head } from './github.mjs'

export async function checkPlan(side, revision) {
  if (!Object.hasOwn(repositories, side)) throw new Error('Invalid documentation side')
  const work = scratch()
  try {
    const remote = (key) => `https://github.com/${repositories[key]}.git`
    fetchRevision(work.repo, remote(side), sha(revision))
    const plan = validatePlan(JSON.parse(git(work.repo, ['show', `${revision}:${planPath}`]).toString()))
    if (plan.destination !== side || contentTree(work.repo, revision, side) !== plan.result)
      throw new Error('PR content does not match its synchronization plan')
    const current = {}
    for (const key of Object.keys(repositories)) {
      const main = sha(await head(key))
      fetchRevision(work.repo, remote(key), main)
      current[key] = contentTree(work.repo, main, key)
    }
    assertCurrentPlan(plan, current)
  } finally {
    work.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { side: { type: 'string' }, head: { type: 'string' } } })
    await checkPlan(values.side, values.head)
    process.stdout.write('Synchronization plan matches both current content trees.\n')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

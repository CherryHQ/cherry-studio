import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFixtures, FIXTURE_MARKERS } from '../fixtureFiles'
import { ensureRunDirectories, getRunPaths } from '../paths'

describe('regression fixtures', () => {
  it('keeps the knowledge answer marker unique to the ground-truth source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-fixtures-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)

    try {
      await createFixtures(paths)
      const knowledgeFiles = ['ground-truth.txt', 'context.md', 'reference.html'].map((name) =>
        join(paths.fixtures, 'knowledge', name)
      )
      const filesWithMarker = knowledgeFiles.filter((filePath) =>
        readFileSync(filePath, 'utf8').includes(FIXTURE_MARKERS.knowledge)
      )

      expect(filesWithMarker).toEqual([join(paths.fixtures, 'knowledge', 'ground-truth.txt')])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFixtures, FIXTURE_MARKERS } from '../fixtures'
import { ensureRunDirectories, getRunPaths } from '../paths'

describe('regression fixtures', () => {
  it('keeps the knowledge answer marker unique to the ground-truth source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-fixtures-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)

    try {
      const manifest = await createFixtures(paths)
      const filesWithMarker = manifest.knowledgeFiles.filter((filePath) =>
        readFileSync(filePath, 'utf8').includes(FIXTURE_MARKERS.knowledge)
      )

      expect(filesWithMarker).toEqual([join(paths.fixtures, 'knowledge', 'ground-truth.txt')])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

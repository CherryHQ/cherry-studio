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

      expect(manifest.knowledgeDirectory).toBe(join(paths.fixtures, 'knowledge'))
      expect(manifest.imageFile).toBe(join(paths.evidence, 'downloads', 'image.png'))
      expect(manifest.skillDirectory).toBe(join(paths.fixtures, 'cherry-regression-fixture'))
      expect(readFileSync(join(manifest.skillDirectory, 'SKILL.md'), 'utf8')).toContain(
        'name: cherry-regression-fixture'
      )
      expect(readFileSync(join(manifest.skillDirectory, 'SKILL.md'), 'utf8')).toContain(
        'installed local skill, not a marketplace lookup'
      )
      expect(filesWithMarker).toEqual([join(paths.fixtures, 'knowledge', 'ground-truth.txt')])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

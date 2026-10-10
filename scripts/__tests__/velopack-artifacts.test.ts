import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { validateVelopackArtifacts } from '../release/velopack-artifacts'

describe('Velopack release publication', () => {
  let directory: string
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'cherry-vpk-release-'))
  })
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  function fixture() {
    for (const arch of ['x64', 'arm64']) {
      const content = Buffer.from(`package-${arch}`)
      const filename = `CherryStudio-cn-2.1.0-win-${arch}-cn-full.nupkg`
      writeFileSync(path.join(directory, filename), content)
      writeFileSync(path.join(directory, `CherryStudio-cn-2.1.0-win-${arch}-Velopack.exe`), 'installer')
      writeFileSync(
        path.join(directory, `releases.win-${arch}-cn.json`),
        JSON.stringify({
          Assets: [
            {
              PackageId: 'CherryStudio-cn',
              Version: '2.1.0',
              Type: 'Full',
              FileName: filename,
              SHA256: createHash('sha256').update(content).digest('hex'),
              Size: content.length
            }
          ]
        })
      )
    }
  }

  it('validates all referenced packages before publication and rejects altered bytes', async () => {
    fixture()
    const files = await validateVelopackArtifacts(directory, 'cn', 'windows', '2.1.0')
    expect(files).toHaveLength(6)
    writeFileSync(path.join(directory, 'CherryStudio-cn-2.1.0-win-arm64-cn-full.nupkg'), 'corrupt')
    await expect(validateVelopackArtifacts(directory, 'cn', 'windows', '2.1.0')).rejects.toThrow('checksum')
  })

  it('rejects a feed pointing at the wrong edition or a missing architecture', async () => {
    fixture()
    const filename = path.join(directory, 'releases.win-x64-cn.json')
    const feed = JSON.parse(readFileSync(filename, 'utf8'))
    feed.Assets[0].PackageId = 'CherryStudio-global'
    writeFileSync(filename, JSON.stringify(feed))
    await expect(validateVelopackArtifacts(directory, 'cn', 'windows', '2.1.0')).rejects.toThrow('identity')
    fixture()
    rmSync(path.join(directory, 'releases.win-arm64-cn.json'))
    await expect(validateVelopackArtifacts(directory, 'cn', 'windows', '2.1.0')).rejects.toThrow()
  })
})

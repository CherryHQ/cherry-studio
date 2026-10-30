import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { type BlockMap, CancellationToken } from 'builder-util-runtime'
import { GenericDifferentialDownloader } from 'electron-updater/out/differentialDownloader/GenericDifferentialDownloader'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { NodeHttpExecutor } = appBuilderRequire('builder-util/out/nodeHttpExecutor')
const projectRoot = path.resolve(import.meta.dirname, '../..')

// Catch multipart-only requests and corrupt reconstructed bytes using the production downloader.
describe('native differential downloads', () => {
  it.each([
    ['global', false],
    ['cn', false],
    ['development', false],
    ['global', true]
  ] as const)('reconstructs using %s feed settings and verifies integrity (corrupt: %s)', async (edition, corrupt) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cherry-differential-'))
    const oldContents = Buffer.from('AAAABBBBCCCCDDDD')
    const newContents = Buffer.from('AAAAXXXXCCCCYYYY')
    const downloaded: string[] = []
    const server = createServer((request, response) => {
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '')
      if (!range) {
        response.writeHead(416).end()
        return
      }
      downloaded.push(request.headers.range!)
      const start = Number(range[1])
      const end = Number(range[2])
      const data = newContents.subarray(start, end + 1)
      response
        .writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${newContents.length}`,
          'Content-Length': data.length,
          'Accept-Ranges': 'bytes'
        })
        .end(corrupt ? Buffer.alloc(data.length) : data)
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server address')
      const config = parse(await readFile(path.join(projectRoot, 'electron-builder.yml'), 'utf8'))
      const feed =
        edition === 'cn'
          ? (
              await require('../../electron-builder.cn.config.cjs')({
                packageMetadata: { value: { version: '2.2.0-rc.1' } }
              })
            ).publish
          : edition === 'development'
            ? parse(await readFile(path.join(projectRoot, 'dev-app-update.yml'), 'utf8'))
            : config.publish
      const oldFile = path.join(directory, 'old.exe')
      const newFile = path.join(directory, 'new.exe')
      await writeFile(oldFile, oldContents)
      const downloader = new GenericDifferentialDownloader(
        { size: newContents.length, sha512: createHash('sha512').update(newContents).digest('base64') },
        new NodeHttpExecutor(),
        {
          oldFile,
          newFile,
          newUrl: new URL(`http://127.0.0.1:${address.port}/installer.exe`),
          isUseMultipleRangeRequest: feed.useMultipleRangeRequest,
          requestHeaders: null,
          cancellationToken: new CancellationToken(),
          logger: { info() {}, warn() {}, error() {} }
        }
      )
      const blockMap = (checksums: string[]): BlockMap => ({
        version: '2',
        files: [{ name: 'file', offset: 0, sizes: [4, 4, 4, 4], checksums }]
      })
      const result = downloader.download(blockMap(['a', 'b', 'c', 'd']), blockMap(['a', 'x', 'c', 'y']))
      if (corrupt) {
        await expect(result).rejects.toThrow(/checksum/i)
      } else {
        await result
        expect(await readFile(newFile)).toEqual(newContents)
        expect(downloaded).toEqual(['bytes=4-7', 'bytes=12-15'])
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})

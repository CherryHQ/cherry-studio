import { createWriteStream } from 'node:fs'

import { ZipArchive } from 'archiver'

const archive = new ZipArchive({ zlib: { level: 9 } })
const output = createWriteStream('meeting-notes.miniapp')
await new Promise((resolve, reject) => {
  output.on('close', resolve)
  output.on('error', reject)
  archive.on('error', reject)
  archive.pipe(output)
  archive.directory('dist', false)
  void archive.finalize().catch(reject)
})

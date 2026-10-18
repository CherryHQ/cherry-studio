import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Resolve a non-clobbering save path for an automatic download: `name.ext`
 * becomes `name (1).ext`, `name (2).ext`, ... while the target exists,
 * mirroring the browser download convention.
 */
export function resolveDownloadSavePath(
  dir: string,
  filename: string,
  exists: (candidate: string) => boolean = (candidate) => fs.existsSync(candidate)
): string {
  // '.' and '..' basename tricks must never resolve outside the download folder.
  const base = path.basename(filename).trim()
  const safeName = !base || base === '.' || base === '..' ? 'download' : base
  const ext = path.extname(safeName)
  const stem = safeName.slice(0, safeName.length - ext.length) || 'download'

  let candidate = path.join(dir, safeName)
  for (let index = 1; exists(candidate); index++) {
    candidate = path.join(dir, `${stem} (${index})${ext}`)
  }
  return candidate
}

// Original synthetic artwork by this automation; licensed AGPL-3.0-only.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')

async function generate() {
  execFileSync('sips', ['--version'])
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'heif-fixture-'))
  try {
    const width = 96,
      height = 64
    const pixels = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const color = y < 32 ? (x < 48 ? [220, 30, 40] : [30, 160, 60]) : x < 48 ? [40, 60, 200] : [245, 245, 245]
        const marker = x >= 8 && x < 16 && y >= 8 && y < 16
        pixels.set([...(marker ? [0, 0, 0] : color), 255], (y * width + x) * 4)
      }
    }
    const png = path.join(temporary, 'quadrants.png')
    const heic = path.join(temporary, 'quadrants.heic')
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(png)
    execFileSync('sips', ['-s', 'format', 'heic', png, '--out', heic])
    const bytes = await fs.readFile(heic)
    await fs.writeFile(path.join(temporary, 'quadrants-truncated.heic'), bytes.subarray(0, 100))
    await fs.copyFile(png, path.join(temporary, 'not-heif.heic'))
    for (const name of ['quadrants.png', 'quadrants.heic', 'quadrants-truncated.heic', 'not-heif.heic']) {
      await fs.copyFile(path.join(temporary, name), path.join(__dirname, name))
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
generate().catch((error) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})

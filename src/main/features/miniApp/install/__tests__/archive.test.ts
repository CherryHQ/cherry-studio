import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MINI_APP_MAX_EXTRACTED_BYTES, MINI_APP_MAX_PACKAGE_BYTES } from '@shared/types/miniAppManifest'

import { extractMiniAppArchive, previewMiniAppArchive, sha256File } from '../archive'

const MANIFEST = {
  id: 'com.example.mygame',
  name: 'My Game',
  description: 'A tiny sample game.',
  version: '1.0.0',
  entry: 'index.html'
}

let work: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-archive-'))
})
afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

async function writeZip(build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip()
  build(zip)
  const p = path.join(work, `pkg-${Math.random().toString(36).slice(2)}.miniapp`)
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  return p
}

// The async `entryData` goes through `stream` too, so a stand-in must keep serving real bytes.
const realStream = StreamZip.async.prototype.stream
const realEntries = StreamZip.async.prototype.entries

/** JSZip will not write such a name; patch the 16-byte `assets/aa/bb.txt` in LOC and CEN instead. */
async function writeZipNamed(evil: string): Promise<string> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(MANIFEST))
  zip.file('index.html', '<h1>hi</h1>')
  zip.file('assets/aa/bb.txt', 'EVIL')
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
  const name = Buffer.from('assets/aa/bb.txt')
  const bad = Buffer.from(evil)
  expect(bad.length).toBe(name.length)
  for (let at = bytes.indexOf(name); at !== -1; at = bytes.indexOf(name, at + 1)) bad.copy(bytes, at)
  const p = path.join(work, `named-${Math.random().toString(36).slice(2)}.miniapp`)
  fs.writeFileSync(p, bytes)
  return p
}

/**
 * A package whose `bombEntry` ships a deflate stream far bigger than the entry table
 * admits. `streamFiles` writes every entry with a data descriptor (general-purpose bit 3),
 * which carries the real sizes AFTER the data — the one shape node-stream-zip does not
 * size-verify — and the central directory is then patched to claim a single byte. Every
 * table check passes, so anything that trusts the table reads the whole inflate.
 */
async function writeDescriptorBomb(bombEntry: string, build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip()
  build(zip)
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', streamFiles: true })
  // Central directory header: flags at +8, uncompressed size at +24, name at +46.
  const header = bytes.lastIndexOf(bombEntry) - 46
  expect(bytes.readUInt16LE(header + 8) & 0x8).toBe(0x8)
  bytes.writeUInt32LE(1, header + 24)
  const p = path.join(work, `bomb-${Math.random().toString(36).slice(2)}.miniapp`)
  fs.writeFileSync(p, bytes)
  return p
}

const dest = () => {
  const d = path.join(work, `dest-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

describe('archive', () => {
  it('extracts a well-formed package and returns its manifest', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
    })
    const d = dest()
    expect((await extractMiniAppArchive(zipPath, d)).id).toBe('com.example.mygame')
    expect(fs.readFileSync(path.join(d, 'index.html'), 'utf8')).toBe('<h1>hi</h1>')
  })

  it('descends into a single wrapping directory', async () => {
    const zipPath = await writeZip((z) => {
      z.file('mygame/manifest.json', JSON.stringify(MANIFEST))
      z.file('mygame/index.html', '<h1>hi</h1>')
    })
    const d = dest()
    await extractMiniAppArchive(zipPath, d)
    expect(fs.existsSync(path.join(d, 'index.html'))).toBe(true)
    expect(fs.existsSync(path.join(d, 'mygame'))).toBe(false)
  })

  it('rejects two top-level directories rather than guessing', async () => {
    const zipPath = await writeZip((z) => {
      z.file('a/manifest.json', JSON.stringify(MANIFEST))
      z.file('b/manifest.json', JSON.stringify(MANIFEST))
    })
    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/manifest\.json/i)
  })

  it('rejects a symlink entry', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
      z.file('escape.txt', '/etc/hosts', { unixPermissions: 0o120777 })
    })
    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/symlink/i)
  })

  it('rejects a package carrying the reserved __cherry directory', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
      z.file('__cherry/theme.css', 'body{}')
    })
    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/__cherry/)
  })

  it('rejects too many entries', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
      for (let i = 0; i < 2001; i++) z.file(`f${i}.txt`, 'x')
    })
    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/too many/i)
  })

  it('rejects a manifest whose entry file is absent', async () => {
    const zipPath = await writeZip((z) => z.file('manifest.json', JSON.stringify(MANIFEST)))
    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/index\.html/)
  })

  it('rejects an archive larger than the package limit before reading it', async () => {
    // 50 MB caps the shipped bytes; 100 MB caps what they unpack to. Only checking
    // the latter means the reader gets handed the file first.
    const zipPath = await writeZip((z) => z.file('manifest.json', JSON.stringify(MANIFEST)))
    vi.spyOn(fs.promises, 'stat').mockResolvedValueOnce({ size: MINI_APP_MAX_PACKAGE_BYTES + 1 } as never)

    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/over the .* limit/i)
  })

  it('rejects a package that unpacks past the extracted limit', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
      // Highly compressible: small on disk, enormous unpacked — the zip-bomb shape.
      z.file('bomb.bin', 'a'.repeat(MINI_APP_MAX_EXTRACTED_BYTES + 1), { compression: 'DEFLATE' })
    })

    await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/unpacks to/i)
  })

  it('caps what actually inflates, not what the entry table claims', async () => {
    const zipPath = await writeDescriptorBomb('bomb.bin', (z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
      z.file('bomb.bin', 'a'.repeat(MINI_APP_MAX_EXTRACTED_BYTES + 1), { compression: 'DEFLATE' })
    })
    const d = dest()

    await expect(extractMiniAppArchive(zipPath, d)).rejects.toThrow(/unpacks to/i)
    expect(fs.readdirSync(d)).toEqual([])
  })

  it('bounds the MANIFEST read at its cap when the entry table lies', async () => {
    // Reached from `previewMiniAppArchive`, which runs BEFORE the user sees the consent
    // card — and before `extractEntries`, whose budget is the one that already held.
    const zipPath = await writeDescriptorBomb('manifest.json', (z) => {
      z.file('manifest.json', 'a'.repeat(1024 * 1024), { compression: 'DEFLATE' })
      z.file('index.html', '<h1>hi</h1>')
    })

    await expect(previewMiniAppArchive(zipPath)).rejects.toThrow(/manifest is over/i)
  })

  it('bounds the ICON read at its cap when the entry table lies', async () => {
    const zipPath = await writeDescriptorBomb('icon.webp', (z) => {
      z.file('manifest.json', JSON.stringify({ ...MANIFEST, icon: { path: 'icon.webp', sha256: 'a'.repeat(64) } }))
      z.file('index.html', '<h1>hi</h1>')
      z.file('icon.webp', 'a'.repeat(6 * 1024 * 1024), { compression: 'DEFLATE' })
    })

    await expect(previewMiniAppArchive(zipPath)).rejects.toThrow(/icon is over/i)
  })

  it('refuses entries that would land outside the package root', async () => {
    for (const evil of ['../../escape.txt', '..\\..\\escape.txt', '/tmp/escape0.txt']) {
      const d = dest()
      const outside = path.resolve(d, evil.replace(/\\/g, '/'))
      // A failing run leaves the escaped file behind, and it must not pass the next run.
      fs.rmSync(outside, { force: true })
      await expect(extractMiniAppArchive(await writeZipNamed(evil), d)).rejects.toThrow(/malicious|escapes/i)
      expect(fs.existsSync(outside)).toBe(false)
      expect(fs.readdirSync(d)).toEqual([])
    }
  })

  it('keeps its own containment check even where the entry table is trusted', async () => {
    // node-stream-zip refuses traversal names while reading the table (`validateName`, off
    // by a config flag). The writer resolves every target itself so the invariant is ours.
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
    })
    const entries = vi.spyOn(StreamZip.async.prototype, 'entries').mockImplementation(async function (this) {
      const table = await realEntries.call(this)
      const index = table['index.html']
      const escape = Object.assign(Object.create(Object.getPrototypeOf(index)), index, { name: '../../escape.txt' })
      return { ...table, '../../escape.txt': escape }
    })
    const d = dest()
    const outside = path.resolve(d, '../../escape.txt')
    fs.rmSync(outside, { force: true })
    try {
      await expect(extractMiniAppArchive(zipPath, d)).rejects.toThrow(/escapes/i)
      expect(fs.existsSync(outside)).toBe(false)
    } finally {
      entries.mockRestore()
    }
  })

  it('rejects a symlink that materialized despite the entry checks', async () => {
    // The entry table says what the archive CLAIMS; this says what landed. The
    // protocol handler downstream trusts the tree, not the archive.
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
    })
    const d = dest()
    const stream = vi.spyOn(StreamZip.async.prototype, 'stream').mockImplementation(async function (this, entry) {
      fs.rmSync(path.join(d, 'leak.txt'), { force: true })
      fs.symlinkSync('/etc/hosts', path.join(d, 'leak.txt'))
      return realStream.call(this, entry)
    })

    await expect(extractMiniAppArchive(zipPath, d)).rejects.toThrow(/symbolic link/i)

    stream.mockRestore()
  })

  it('leaves nothing behind when the tree is refused AFTER it landed', async () => {
    // An entry-table refusal never touches `dest`, so an empty directory there proves
    // nothing. Only a post-extraction refusal has anything to clean up.
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
    })
    const d = dest()
    const stream = vi.spyOn(StreamZip.async.prototype, 'stream').mockImplementation(async function (this, entry) {
      fs.mkdirSync(path.join(d, 'assets'), { recursive: true })
      fs.rmSync(path.join(d, 'assets', 'leak.txt'), { force: true })
      fs.symlinkSync('/etc/hosts', path.join(d, 'assets', 'leak.txt'))
      return realStream.call(this, entry)
    })
    try {
      await expect(extractMiniAppArchive(zipPath, d)).rejects.toThrow(/symbolic link/i)
    } finally {
      stream.mockRestore()
    }

    expect(fs.readdirSync(d)).toEqual([])
  })

  it('keeps the archive error when the reset itself fails', async () => {
    // The caller acts on the refusal — an EPERM from the wipe must not replace it.
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('escape.txt', '/etc/hosts', { unixPermissions: 0o120777 })
    })
    const rm = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('EPERM'))
    try {
      await expect(extractMiniAppArchive(zipPath, dest())).rejects.toThrow(/symlink/i)
    } finally {
      rm.mockRestore()
    }
  })

  it('previews the consent-card data without unpacking anything', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('index.html', '<h1>hi</h1>')
    })
    const before = fs.readdirSync(path.dirname(zipPath))

    const preview = await previewMiniAppArchive(zipPath)

    expect(preview.manifest.id).toBe(MANIFEST.id)
    // The pin confirm re-computes; a preview that hashed nothing could not refuse a swap.
    expect(preview.sha256).toBe(await sha256File(zipPath))
    // Nothing extracted: preview's whole point is holding no staging tree (§10.2).
    expect(fs.readdirSync(path.dirname(zipPath))).toEqual(before)
  })

  it('refuses a manifest entry over the byte cap before reading it', async () => {
    // The total-size cap admits one huge entry. This gate fires on the table's `size`,
    // before anything is read; the bounded read below is what catches a table that lies.
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify({ ...MANIFEST, description: 'x'.repeat(300 * 1024) }))
      z.file('index.html', '<h1>hi</h1>')
    })

    await expect(previewMiniAppArchive(zipPath)).rejects.toThrow(/manifest is over/i)
  })

  it('refuses an oversized icon entry before reading it', async () => {
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify({ ...MANIFEST, icon: { path: 'icon.webp', sha256: 'a'.repeat(64) } }))
      z.file('index.html', '<h1>hi</h1>')
      z.file('icon.webp', Buffer.alloc(6 * 1024 * 1024))
    })

    await expect(previewMiniAppArchive(zipPath)).rejects.toThrow(/icon is over/i)
  })

  it('hands the card a REAL 128x128 webp whatever the package shipped', async () => {
    // Straight entry bytes → base64 under an `image/webp` label is a lie for a PNG; the
    // install pipeline's transcode makes the label true.
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#f00' } })
      .png()
      .toBuffer()
    const zipPath = await writeZip((z) => {
      z.file(
        'manifest.json',
        JSON.stringify({
          ...MANIFEST,
          icon: { path: 'icon.png', sha256: crypto.createHash('sha256').update(png).digest('hex') }
        })
      )
      z.file('index.html', '<h1>hi</h1>')
      z.file('icon.png', png)
    })

    const preview = await previewMiniAppArchive(zipPath)

    const bytes = Buffer.from(preview.iconDataUrl!.split(',')[1], 'base64')
    const meta = await sharp(bytes).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 128, 128])
  })

  it('refuses at preview what extraction would refuse', async () => {
    // Same `scanArchive`, both callers: a package the installer would reject must not
    // reach the consent card and fail only after the user already said yes.
    const zipPath = await writeZip((z) => {
      z.file('manifest.json', JSON.stringify(MANIFEST))
      z.file('escape.txt', '/etc/hosts', { unixPermissions: 0o120777 })
    })

    await expect(previewMiniAppArchive(zipPath)).rejects.toThrow(/symlink/i)
  })
})

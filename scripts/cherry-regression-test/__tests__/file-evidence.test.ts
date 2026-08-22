import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import JSZip from 'jszip'
import sharp from 'sharp'

import { validateFileEvidence } from '../file-evidence'

describe('generated artifact evidence', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cherry-regression-evidence-'))
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it('requires the exact marker in Agent output files', async () => {
    const filePath = join(directory, 'agent-result.txt')
    writeFileSync(filePath, 'wrong result\n')

    await expect(
      validateFileEvidence(filePath, { expectedText: 'AGENT_FILE_TASK_PASS', type: 'text' })
    ).rejects.toThrow('does not contain the expected text')
  })

  it('rejects a blank image and accepts a decodable non-blank image', async () => {
    const blank = join(directory, 'blank.png')
    await sharp({ create: { background: 'white', channels: 3, height: 64, width: 64 } })
      .png()
      .toFile(blank)
    await expect(validateFileEvidence(blank, { type: 'image' })).rejects.toThrow('blank or too small')

    const pixels = Buffer.alloc(64 * 64 * 3)
    for (let index = 0; index < pixels.length; index += 3) {
      pixels[index] = index % 251
      pixels[index + 1] = (index / 3) % 241
      pixels[index + 2] = 127
    }
    const generated = join(directory, 'generated.png')
    await sharp(pixels, { raw: { channels: 3, height: 64, width: 64 } })
      .png()
      .toFile(generated)

    await expect(validateFileEvidence(generated, { type: 'image' })).resolves.toMatchObject({
      height: 64,
      width: 64
    })
  })

  it('checks the fixed PPT title and exact slide count', async () => {
    const archive = new JSZip()
    archive.file('[Content_Types].xml', '<Types />')
    for (let slide = 1; slide <= 3; slide += 1) {
      archive.file(
        `ppt/slides/slide${slide}.xml`,
        `<p:sld><a:t>${slide === 1 ? 'Cherry Regression 31415' : `Slide ${slide}`}</a:t></p:sld>`
      )
    }
    const filePath = join(directory, 'result.pptx')
    writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }))

    await expect(
      validateFileEvidence(filePath, {
        exactSlides: 3,
        expectedText: 'Cherry Regression 31415',
        type: 'pptx'
      })
    ).resolves.toMatchObject({ slides: 3 })
    await expect(validateFileEvidence(filePath, { exactSlides: 4, type: 'pptx' })).rejects.toThrow(
      'Expected 4 PPTX slides'
    )
  })
})

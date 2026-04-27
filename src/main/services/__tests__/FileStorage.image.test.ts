import { describe, expect, it, vi } from 'vitest'

// Must be mocked before FileStorage is imported

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1000 }),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  },
  createReadStream: vi.fn(),
  createWriteStream: vi.fn()
}))

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }))

vi.mock('@main/utils/file', () => ({
  getFilesDir: () => '/mock/files',
  getNotesDir: () => '/mock/notes',
  getTempDir: () => '/mock/temp',
  getFileType: (ext: string) => {
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) return 'image'
    return 'document'
  },
  checkName: vi.fn(),
  getName: vi.fn(),
  readTextFileWithAutoEncoding: vi.fn(),
  scanDir: vi.fn()
}))

vi.mock('@main/utils', () => ({ toAsarUnpackedPath: (p: string) => p }))
vi.mock('@main/utils/locales', () => ({ t: (k: string) => k }))

vi.mock('@shared/utils', () => ({
  parseDataUrl: (data: string) => {
    if (!data.startsWith('data:')) return null
    const [header, body] = data.split(',')
    const mediaType = header.replace('data:', '').replace(';base64', '')
    return { mediaType, data: body ?? '' }
  }
}))

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() })) }
}))

vi.mock('chardet', () => ({ default: { detect: vi.fn() } }))
vi.mock('isbinaryfile', () => ({ isBinaryFile: vi.fn().mockResolvedValue(false) }))
vi.mock('officeparser', () => ({ default: { parseOfficeAsync: vi.fn() } }))
vi.mock('pdf-lib', () => ({ PDFDocument: { load: vi.fn() } }))
vi.mock('word-extractor', () => ({
  default: vi.fn().mockImplementation(() => ({ extract: vi.fn() }))
}))

// Import after all mocks are declared
import { fileStorage } from '../FileStorage'

const PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ' +
  'AABjkB6QAAAABJRU5ErkJggg=='

const JPEG_BASE64 =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQ' +
  'NDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAED' +
  'ASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAQQCAgMBAAAAAAAAAAAAAQIDBBEF' +
  'EiExQf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEA' +
  'PwCvo2lqRWxZjrF3cSMGxMeLhEqbfLqLpPcb0qTe/9k='

describe('FileStorage image saving — ext must include leading dot', () => {
  describe('saveBase64Image', () => {
    it('returns ext ".png" for image/png base64', async () => {
      const result = await fileStorage.saveBase64Image(null as any, PNG_BASE64)
      expect(result.ext).toBe('.png')
    })

    it('returns ext ".jpg" for image/jpeg base64', async () => {
      const result = await fileStorage.saveBase64Image(null as any, JPEG_BASE64)
      expect(result.ext).toBe('.jpg')
    })

    it('ext always starts with a dot', async () => {
      const result = await fileStorage.saveBase64Image(null as any, PNG_BASE64)
      expect(result.ext.startsWith('.')).toBe(true)
    })
  })

  describe('savePastedImage', () => {
    const buf = Buffer.from('fake-image-data')

    it('returns ext ".png" when passed ".png"', async () => {
      const result = await fileStorage.savePastedImage(null as any, buf, '.png')
      expect(result.ext).toBe('.png')
    })

    it('defaults to ".png" when no extension is provided', async () => {
      const result = await fileStorage.savePastedImage(null as any, buf)
      expect(result.ext).toBe('.png')
    })

    it('ext always starts with a dot', async () => {
      const result = await fileStorage.savePastedImage(null as any, buf, '.webp')
      expect(result.ext).toBe('.webp')
    })
  })
})

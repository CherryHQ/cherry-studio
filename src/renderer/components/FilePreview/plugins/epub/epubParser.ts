import JSZip from 'jszip'

export const EPUB_SOURCE_MAX_BYTES = 25 * 1024 * 1024
export const EPUB_ENTRY_MAX_COUNT = 4000
export const EPUB_MEMBER_READ_MAX_BYTES = 2 * 1024 * 1024
export type EpubFailureReason = 'damaged' | 'unsupported_structure' | 'encrypted' | 'too_large'
export class EpubError extends Error {
  constructor(readonly reason: EpubFailureReason) {
    super(reason)
  }
}
export interface EpubChapter {
  readonly id: string
  readonly path: string
}
export interface EpubChapterContent {
  readonly title?: string
  readonly paragraphs: readonly string[]
}
export interface EpubBook {
  readonly chapters: readonly EpubChapter[]
  readChapter(id: string): Promise<EpubChapterContent>
  close(): void
}

function resolvePath(base: string, href: string): string {
  const path = href.split('#')[0]
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[a-z][a-z\d+.-]*:/i.test(path))
    throw new EpubError('unsupported_structure')
  const parts = base ? base.split('/') : []
  try {
    for (const encoded of path.split('/')) {
      const part = decodeURIComponent(encoded)
      if (part.includes('/') || part.includes('\\')) throw new Error()
      if (part === '..') {
        if (!parts.length) throw new Error()
        parts.pop()
      } else if (part && part !== '.') parts.push(part)
    }
  } catch {
    throw new EpubError('unsupported_structure')
  }
  if (!parts.length) throw new EpubError('unsupported_structure')
  return parts.join('/')
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new EpubError('unsupported_structure')
  return doc
}
function elements(doc: Document | Element, name: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS('*', name))
}
function decode(bytes: Uint8Array): string {
  let encoding = 'utf-8',
    offset = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le'
    offset = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be'
    offset = 2
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset))
  } catch {
    throw new EpubError('unsupported_structure')
  }
}
function chapterContent(text: string): EpubChapterContent {
  let doc: Document
  try {
    doc = parseXml(text)
  } catch {
    doc = new DOMParser().parseFromString(text, 'text/html')
  }
  const title =
    elements(doc, 'title')[0]?.textContent?.trim() ||
    Array.from(doc.getElementsByTagName('*'))
      .filter((element) => /^h[1-6]$/i.test(element.localName))
      .map((el) => el.textContent?.trim())
      .find(Boolean)
  const body = elements(doc, 'body')[0]
  if (!body) throw new EpubError('unsupported_structure')
  const blocks = new Set([
    'p',
    'div',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'br',
    'tr',
    'section',
    'blockquote',
    'pre',
    'article',
    'figcaption'
  ])
  const cells = new Set(['td', 'th', 'dt', 'dd'])
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const tag = el.localName.toLowerCase()
    if (['script', 'style', 'head', 'noscript'].includes(tag)) return ''
    const content = Array.from(node.childNodes, walk).join('')
    if (cells.has(tag)) return `${content} `
    return blocks.has(tag) ? `\n${content}\n` : content
  }
  const content = walk(body)
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim()
  return {
    title,
    paragraphs: content
      ? content
          .split(/\n[ \t]*\n/)
          .map((part) => part.trim())
          .filter(Boolean)
      : []
  }
}

export async function openEpub(bytes: Uint8Array): Promise<EpubBook> {
  if (bytes.byteLength > EPUB_SOURCE_MAX_BYTES) throw new EpubError('too_large')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new EpubError('damaged')
  }
  if (Object.keys(zip.files).length > EPUB_ENTRY_MAX_COUNT) throw new EpubError('too_large')
  let closed = false
  const read = async (path: string) => {
    if (closed) throw new Error('EPUB closed')
    const file = zip.file(path)
    if (!file) throw new EpubError('unsupported_structure')
    const data = await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = []
      let size = 0
      const stream = (
        file as JSZip.JSZipObject & {
          internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
        }
      ).internalStream('uint8array')
      stream.on('data', (chunk: Uint8Array) => {
        size += chunk.byteLength
        if (size > EPUB_MEMBER_READ_MAX_BYTES) {
          stream.pause()
          reject(new EpubError('too_large'))
          return
        }
        chunks.push(chunk)
      })
      stream.on('error', () => reject(new EpubError('damaged')))
      stream.on('end', () => {
        const result = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.byteLength
        }
        resolve(result)
      })
      stream.resume()
    })
    if (closed) throw new Error('EPUB closed')
    return decode(data)
  }
  const container = parseXml(await read('META-INF/container.xml'))
  let opfPath = ''
  for (const element of elements(container, 'rootfile')) {
    const root = element.getAttribute('full-path')
    if (!root) continue
    try {
      opfPath = resolvePath('', root)
      break
    } catch {
      continue
    }
  }
  if (!opfPath) throw new EpubError('unsupported_structure')
  const opf = parseXml(await read(opfPath))
  const dir = opfPath.split('/').slice(0, -1).join('/')
  const manifest = new Map(elements(opf, 'item').map((el) => [el.getAttribute('id'), el.getAttribute('href')]))
  const refs = elements(opf, 'itemref')
  if (!elements(opf, 'spine').length || !refs.length) throw new EpubError('unsupported_structure')
  let locatable = 0
  const chapters = refs.map((ref, index) => {
    const href = manifest.get(ref.getAttribute('idref'))
    let path = ''
    try {
      if (href) {
        path = resolvePath(dir, href)
        locatable++
      }
    } catch {
      /* retained as unreadable */
    }
    return { id: String(index), path }
  })
  if (!locatable) throw new EpubError('unsupported_structure')
  const encrypted = new Set<string>()
  if (zip.file('META-INF/encryption.xml')) {
    const encryption = parseXml(await read('META-INF/encryption.xml'))
    for (const ref of elements(encryption, 'CipherReference')) {
      const uri = ref.getAttribute('URI')
      if (uri) {
        try {
          encrypted.add(resolvePath('', uri))
        } catch {
          /* invalid URI cannot identify a chapter */
        }
      }
    }
  }
  return {
    chapters,
    async readChapter(id) {
      if (closed) throw new Error('EPUB closed')
      const chapter = chapters.find((item) => item.id === id)
      if (!chapter?.path) throw new EpubError('unsupported_structure')
      if (encrypted.has(chapter.path)) throw new EpubError('encrypted')
      return chapterContent(await read(chapter.path))
    },
    close() {
      closed = true
    }
  }
}

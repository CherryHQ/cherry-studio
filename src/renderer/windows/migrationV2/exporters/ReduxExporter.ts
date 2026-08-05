/**
 * Redux Persist data exporter for migration
 * Extracts selected persisted Redux slices from localStorage into bounded files.
 */

import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { clampSurrogateBoundary } from '@shared/utils/text'

const PERSIST_KEY = 'persist:cherry-studio'
const EXPORT_CHUNK_CHAR_LIMIT = 1024 * 1024

// Redux slices that need to be migrated
const SLICES_TO_EXPORT = [
  'settings', // App settings and preferences
  'assistants', // Assistant configurations
  'knowledge', // Knowledge base metadata
  'llm', // LLM provider and model configurations
  'mcp', // MCP server configurations
  'minapps', // Mini app configurations (enabled/disabled/pinned)
  'note', // Note-related settings
  'selectionStore', // Selection assistant settings
  'preprocess', // File preprocess provider configurations
  'ocr', // OCR provider configurations
  'websearch', // Web search configurations
  'codeTools', // Code tools settings (CLI tool, models, terminal)
  'paintings' // Painting history per provider/mode (consumed by PaintingMigrator)
]

export interface ReduxExportResult {
  exportPath: string
  slicesFound: string[]
  slicesMissing: string[]
}

export class ReduxExporter {
  private skipWhitespace(text: string, offset: number): number {
    while (offset < text.length && /\s/u.test(text[offset])) offset++
    return offset
  }

  private scanStringEnd(text: string, start: number): number {
    if (text[start] !== '"') throw new SyntaxError(`Expected string at offset ${start}`)
    for (let offset = start + 1; offset < text.length; offset++) {
      if (text[offset] === '\\') {
        offset++
      } else if (text[offset] === '"') {
        return offset + 1
      }
    }
    throw new SyntaxError(`Unterminated string at offset ${start}`)
  }

  private scanValueEnd(text: string, start: number): number {
    if (text[start] === '"') return this.scanStringEnd(text, start)
    if (text[start] !== '{' && text[start] !== '[') {
      let offset = start
      while (offset < text.length && text[offset] !== ',' && text[offset] !== '}') offset++
      return offset
    }

    const expectedClosers: string[] = []
    let offset = start
    while (offset < text.length) {
      const char = text[offset]
      if (char === '"') {
        offset = this.scanStringEnd(text, offset)
        continue
      }
      if (char === '{') expectedClosers.push('}')
      else if (char === '[') expectedClosers.push(']')
      else if (char === '}' || char === ']') {
        if (expectedClosers.pop() !== char) throw new SyntaxError(`Mismatched JSON delimiter at offset ${offset}`)
        if (expectedClosers.length === 0) return offset + 1
      }
      offset++
    }
    throw new SyntaxError(`Unterminated JSON value at offset ${start}`)
  }

  private async visitPersistedSlices(
    rawData: string,
    onSlice: (sliceName: string, valueStart: number, valueEnd: number) => Promise<void>
  ): Promise<void> {
    let offset = this.skipWhitespace(rawData, 0)
    if (rawData[offset] !== '{') throw new SyntaxError('Redux Persist root must be a JSON object')
    offset = this.skipWhitespace(rawData, offset + 1)
    if (rawData[offset] === '}') return

    while (offset < rawData.length) {
      const keyEnd = this.scanStringEnd(rawData, offset)
      const key = JSON.parse(rawData.slice(offset, keyEnd)) as unknown
      if (typeof key !== 'string') throw new SyntaxError(`Invalid Redux Persist key at offset ${offset}`)
      offset = this.skipWhitespace(rawData, keyEnd)
      if (rawData[offset] !== ':') throw new SyntaxError(`Expected ':' after Redux Persist key '${key}'`)
      offset = this.skipWhitespace(rawData, offset + 1)
      const valueEnd = this.scanValueEnd(rawData, offset)

      if (SLICES_TO_EXPORT.includes(key)) {
        if (rawData[offset] !== '"') throw new SyntaxError(`Redux Persist slice '${key}' is not a string`)
        await onSlice(key, offset, valueEnd)
      }

      offset = this.skipWhitespace(rawData, valueEnd)
      if (rawData[offset] === '}') {
        offset = this.skipWhitespace(rawData, offset + 1)
        if (offset !== rawData.length) throw new SyntaxError(`Unexpected data at offset ${offset}`)
        return
      }
      if (rawData[offset] !== ',') throw new SyntaxError(`Expected ',' at offset ${offset}`)
      offset = this.skipWhitespace(rawData, offset + 1)
    }
    throw new SyntaxError('Unterminated Redux Persist root object')
  }

  private async writeSliceChunk(
    exportPath: string,
    sliceName: string,
    chunk: string,
    writeMode: 'overwrite' | 'append'
  ): Promise<void> {
    await window.electron.ipcRenderer.invoke(
      MigrationIpcChannels.WriteExportFile,
      exportPath,
      sliceName,
      chunk,
      writeMode
    )
  }

  /** Decode one Redux Persist JSON-string token directly to disk in bounded chunks. */
  private async writeSlice(
    exportPath: string,
    sliceName: string,
    rawData: string,
    valueStart: number,
    valueEnd: number
  ): Promise<void> {
    let pending = ''
    let writeMode: 'overwrite' | 'append' = 'overwrite'

    const flush = async () => {
      if (pending.length <= EXPORT_CHUNK_CHAR_LIMIT) return
      const end = clampSurrogateBoundary(pending, EXPORT_CHUNK_CHAR_LIMIT)
      if (end === 0) return
      const chunk = pending.slice(0, end)
      pending = pending.slice(end)
      await this.writeSliceChunk(exportPath, sliceName, chunk, writeMode)
      writeMode = 'append'
    }

    const append = async (text: string) => {
      pending += text
      while (pending.length > EXPORT_CHUNK_CHAR_LIMIT) await flush()
    }

    let offset = valueStart + 1
    const contentEnd = valueEnd - 1
    while (offset < contentEnd) {
      let spanEnd = offset
      const requestedSpanEnd = Math.min(offset + EXPORT_CHUNK_CHAR_LIMIT, contentEnd)
      const spanLimit = clampSurrogateBoundary(rawData, requestedSpanEnd)
      while (spanEnd < spanLimit && rawData[spanEnd] !== '\\') {
        if (rawData.charCodeAt(spanEnd) <= 0x1f) {
          throw new SyntaxError(`Unescaped control character in Redux Persist slice '${sliceName}'`)
        }
        spanEnd++
      }
      if (spanEnd > offset) await append(rawData.slice(offset, spanEnd))
      if (spanEnd === contentEnd) break
      if (rawData[spanEnd] !== '\\') {
        offset = spanEnd
        continue
      }

      const escape = rawData[spanEnd + 1]
      switch (escape) {
        case '"':
        case '\\':
        case '/':
          await append(escape)
          offset = spanEnd + 2
          break
        case 'b':
          await append('\b')
          offset = spanEnd + 2
          break
        case 'f':
          await append('\f')
          offset = spanEnd + 2
          break
        case 'n':
          await append('\n')
          offset = spanEnd + 2
          break
        case 'r':
          await append('\r')
          offset = spanEnd + 2
          break
        case 't':
          await append('\t')
          offset = spanEnd + 2
          break
        case 'u': {
          const hex = rawData.slice(spanEnd + 2, spanEnd + 6)
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
            throw new SyntaxError(`Invalid Unicode escape in Redux Persist slice '${sliceName}'`)
          }
          await append(String.fromCharCode(Number.parseInt(hex, 16)))
          offset = spanEnd + 6
          break
        }
        default:
          throw new SyntaxError(`Invalid escape sequence in Redux Persist slice '${sliceName}'`)
      }
    }

    while (pending.length > EXPORT_CHUNK_CHAR_LIMIT) await flush()
    if (pending.length > 0 || writeMode === 'overwrite') {
      await this.writeSliceChunk(exportPath, sliceName, pending, writeMode)
    }
  }

  /**
   * Export Redux Persist data from localStorage
   * Writes selected slices to separate files without parsing their contents.
   */
  async export(exportPath: string): Promise<ReduxExportResult> {
    let rawData = localStorage.getItem(PERSIST_KEY)

    if (!rawData) {
      return {
        exportPath,
        slicesFound: [],
        slicesMissing: [...SLICES_TO_EXPORT]
      }
    }

    const foundSlices = new Set<string>()
    try {
      await this.visitPersistedSlices(rawData, async (sliceName, valueStart, valueEnd) => {
        await this.writeSlice(exportPath, sliceName, rawData!, valueStart, valueEnd)
        foundSlices.add(sliceName)
      })
    } catch (error) {
      throw new Error(`Failed to parse Redux Persist root data: ${error}`)
    }
    rawData = null
    const slicesFound = SLICES_TO_EXPORT.filter((sliceName) => foundSlices.has(sliceName))
    const slicesMissing = SLICES_TO_EXPORT.filter((sliceName) => !foundSlices.has(sliceName))

    return {
      exportPath,
      slicesFound,
      slicesMissing
    }
  }

  /**
   * Get raw Redux Persist data for debugging
   */
  getRawData(): string | null {
    return localStorage.getItem(PERSIST_KEY)
  }

  /**
   * Check if Redux Persist data exists
   */
  hasData(): boolean {
    return localStorage.getItem(PERSIST_KEY) !== null
  }

  /**
   * Get list of all persisted slices
   */
  getPersistedSlices(): string[] {
    const rawData = localStorage.getItem(PERSIST_KEY)
    if (!rawData) return []

    try {
      const persistedState = JSON.parse(rawData)
      return Object.keys(persistedState).filter((key) => key !== '_persist')
    } catch {
      return []
    }
  }
}

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import type { FileType } from '@shared/file/types/common'

export interface DexieInternalRowSpec {
  kind: 'internal'
  id: string
  name: string // storage name (no ext)
  origin_name: string // user-visible name (with ext)
  ext?: string // include leading dot; derived from origin_name if omitted
  size?: number
  type?: FileType
  count?: number
  created_at?: string
}

export interface DexieExternalRowSpec {
  kind: 'external'
  id: string
  path: string // absolute external path
  size?: number
  type?: FileType
  created_at?: string
}

export type DexieFileRowSpec = DexieInternalRowSpec | DexieExternalRowSpec

const extOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot)
}

export function buildDexieFileRow(spec: DexieFileRowSpec): FileMetadata {
  if (spec.kind === 'external') {
    const basename = spec.path.split('/').pop() ?? spec.path
    const ext = extOf(basename)
    return {
      id: spec.id,
      name: basename,
      origin_name: basename,
      path: spec.path,
      size: spec.size ?? 1024,
      ext,
      type: spec.type ?? 'document',
      created_at: spec.created_at ?? '2024-01-01T00:00:00.000Z',
      count: 1
    }
  }

  // internal branch
  const ext = spec.ext ?? extOf(spec.origin_name)
  return {
    id: spec.id,
    name: spec.name,
    origin_name: spec.origin_name,
    path: `/userData/Data/Files/${spec.id}${ext}`,
    size: spec.size ?? 1024,
    ext,
    type: spec.type ?? 'document',
    created_at: spec.created_at ?? '2024-01-01T00:00:00.000Z',
    count: spec.count ?? 1
  }
}

export interface BuildDexieTableOptions {
  physicalRoot: string // absolute path; internal files seeded under `${root}/Data/Files/`
  rows: DexieFileRowSpec[]
}

export async function buildDexieFilesTable(options: BuildDexieTableOptions): Promise<FileMetadata[]> {
  const rows = options.rows.map(buildDexieFileRow)
  for (const row of rows) {
    // Only seed internal physical files; external rows reference user paths we don't own
    if (row.path.startsWith('/userData/Data/Files/')) {
      const realPath = row.path.replace('/userData', options.physicalRoot)
      mkdirSync(dirname(realPath), { recursive: true })
      writeFileSync(realPath, Buffer.alloc(row.size))
    }
  }
  return rows
}

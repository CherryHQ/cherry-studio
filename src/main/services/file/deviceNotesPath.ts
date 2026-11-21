import { promises as fs } from 'node:fs'

import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

/** Read this PC's Notes folder choice. Missing/corrupt/non-string content means no choice. */
export async function readDeviceNotesPath(sidecarFile: string): Promise<string | null> {
  let raw: string
  try {
    raw = await fs.readFile(sidecarFile, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = (parsed as { path?: unknown }).path
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/** Overwrites any previous choice. Atomic (tmp + rename), so racing writers leave the previous or the new choice — never torn JSON. */
export async function writeDeviceNotesPath(sidecarFile: string, notesPath: string): Promise<void> {
  await atomicWriteFile(AbsoluteFilePathSchema.parse(sidecarFile), JSON.stringify({ path: notesPath }))
}

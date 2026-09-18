import { promises as fs } from 'node:fs'

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

/** Persist this PC's Notes folder choice. Overwrites any previous choice. */
export async function writeDeviceNotesPath(sidecarFile: string, notesPath: string): Promise<void> {
  await fs.writeFile(sidecarFile, JSON.stringify({ path: notesPath }), 'utf8')
}

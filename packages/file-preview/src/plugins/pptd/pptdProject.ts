/**
 * Loading and validation for a PPTD project: the .pptd manifest plus every
 * referenced .page file. Missing or invalid pieces surface as typed results
 * so the preview can render visible placeholders instead of failing the deck.
 */
import { parse as parseYaml } from 'yaml'

import type { PreviewDocument } from '../../source'
import type { PreviewResources } from '../../types'
import type { PptdElement, PptdPage, PptdPageElement, PptdPresentation } from './pptdFormat'
import { pptdElementSchema, pptdPageSchema, pptdPresentationSchema } from './pptdFormat'

export interface PptdProjectPageOk {
  path: string
  status: 'ok'
  page: PptdPage
  elements: PptdPageElement[]
}

export interface PptdProjectPageFailed {
  path: string
  status: 'missing' | 'invalid'
  reason: string
}

export type PptdProjectPage = PptdProjectPageOk | PptdProjectPageFailed

export interface PptdProject {
  presentation: PptdPresentation
  pages: PptdProjectPage[]
}

export type PptdProjectFileReader = (relativePath: string, signal?: AbortSignal) => Promise<Uint8Array>

const textDecoder = new TextDecoder()

function decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

function yamlErrorReason(error: unknown): string {
  return error instanceof Error ? error.message.split('\n', 1)[0] : String(error)
}

/** Validates one raw element; invalid elements become placeholders, never dropped. */
export function parsePptdElement(raw: unknown, index: number): PptdPageElement {
  const result = pptdElementSchema.safeParse(raw)
  if (result.success) {
    return result.data as PptdElement
  }
  const candidate = (raw ?? {}) as Record<string, unknown>
  const declaredType = typeof candidate.elementType === 'string' ? candidate.elementType : 'unknown'
  const elementId =
    typeof candidate.elementId === 'string' && candidate.elementId.length > 0
      ? candidate.elementId
      : `element-${index + 1}`
  const bounds = Array.isArray(candidate.bounds)
    ? (candidate.bounds.filter((entry) => typeof entry === 'number') as [number, number, number, number])
    : null
  return {
    elementType: 'invalid',
    elementId,
    declaredType,
    reason: result.error.issues[0]?.message ?? 'Invalid element',
    bounds: bounds?.length === 4 ? bounds : null
  }
}

export function parsePptdPage(bytes: Uint8Array): PptdProjectPageOk {
  const raw = parseYaml(decode(bytes))
  const page = pptdPageSchema.parse(raw)
  return {
    path: '',
    status: 'ok',
    page,
    elements: page.elements.map((element, index) => parsePptdElement(element, index))
  }
}

export function parsePptdPresentation(bytes: Uint8Array): PptdPresentation {
  const raw = parseYaml(decode(bytes))
  return pptdPresentationSchema.parse(raw)
}

/** Resolves the readProjectFile host hook, failing loudly when the host cannot read project files. */
export function requireProjectFileReader(resources: PreviewResources | undefined): PptdProjectFileReader {
  const reader = resources?.readProjectFile
  if (!reader) {
    throw new Error('This host cannot read PPTD project files')
  }
  return reader
}

/** True when the media source is a remote HTTPS URL per the upstream reference. */
export function isRemotePptdSource(src: string): boolean {
  return /^https:\/\//i.test(src.trim())
}

export async function loadPptdProject(
  document: PreviewDocument,
  readProjectFile: PptdProjectFileReader,
  signal?: AbortSignal
): Promise<PptdProject> {
  const manifestBytes = await document.readRange(0, document.size, signal)
  const presentation = parsePptdPresentation(manifestBytes)

  const pages: PptdProjectPage[] = []
  for (const path of presentation.pages) {
    signal?.throwIfAborted()
    let bytes: Uint8Array
    try {
      bytes = await readProjectFile(path, signal)
    } catch (error) {
      pages.push({ path, status: 'missing', reason: yamlErrorReason(error) })
      continue
    }
    try {
      pages.push({ ...parsePptdPage(bytes), path })
    } catch (error) {
      pages.push({ path, status: 'invalid', reason: yamlErrorReason(error) })
    }
  }

  return { presentation, pages }
}

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { dialog } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import type {
  UarKnowledgeSearchResult,
  UarKnowledgeUploadResult,
  UarOperationalSnapshot
} from '@shared/types/prometheusIntegration'

import { body, ownerRequest, readUarOperations } from './UarOperationalAdministrationAdapter'
export async function createUarKnowledgeBase(input: {
  sessionId: string
  name: string
  description?: string
}): Promise<UarOperationalSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  await body(
    await ownerRequest(
      input.sessionId,
      '/api/uar/knowledge-bases',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.name, description: input.description })
      },
      endpoint.generation
    ),
    'Knowledge base creation'
  )
  return readUarOperations()
}

export async function deleteUarKnowledgeBase(
  sessionId: string,
  knowledgeBaseId: string
): Promise<UarOperationalSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  await body(
    await ownerRequest(
      sessionId,
      `/api/uar/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
      { method: 'DELETE' },
      endpoint.generation
    ),
    'Knowledge base deletion'
  )
  return readUarOperations()
}

export async function searchUarKnowledge(input: {
  sessionId: string
  knowledgeBaseId: string
  query: string
}): Promise<UarKnowledgeSearchResult[]> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  const response = z
    .object({
      results: z.array(
        z.object({
          content: z.string(),
          score: z.number(),
          document_id: z.string().nullable().optional()
        })
      )
    })
    .parse(
      await body(
        await ownerRequest(
          input.sessionId,
          `/api/uar/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/search`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: input.query })
          },
          endpoint.generation
        ),
        'Knowledge search'
      )
    )
  return response.results.map((result) => ({
    content: result.content,
    score: result.score,
    ...(result.document_id ? { documentId: result.document_id } : {})
  }))
}

export async function uploadUarKnowledgeDocument(
  sessionId: string,
  knowledgeBaseId: string
): Promise<UarKnowledgeUploadResult> {
  const picked = await dialog.showOpenDialog({ properties: ['openFile'] })
  if (picked.canceled || !picked.filePaths[0]) {
    return { cancelled: true, snapshot: await readUarOperations() }
  }
  const filePath = picked.filePaths[0]
  const filename = basename(filePath)
  const bytes = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([bytes]), filename)
  const endpoint = await application.get('UarSidecarService').ensureReady()
  await body(
    await ownerRequest(
      sessionId,
      `/api/uar/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`,
      { method: 'POST', body: form },
      endpoint.generation
    ),
    'Knowledge document upload'
  )
  return { cancelled: false, filename, snapshot: await readUarOperations() }
}

export async function deleteUarKnowledgeDocument(
  sessionId: string,
  knowledgeBaseId: string,
  documentId: string
): Promise<UarOperationalSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  await body(
    await ownerRequest(
      sessionId,
      `/api/uar/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
      { method: 'DELETE' },
      endpoint.generation
    ),
    'Knowledge document deletion'
  )
  return readUarOperations()
}

export async function createUarMemory(content: string, userId?: string): Promise<UarOperationalSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  await body(
    await application.get('UarSidecarService').adminRequest(
      '/api/admin/memories',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, user_id: userId })
      },
      endpoint.generation
    ),
    'Memory creation'
  )
  return readUarOperations()
}

export async function deleteUarMemory(id: string): Promise<UarOperationalSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  await body(
    await application
      .get('UarSidecarService')
      .adminRequest(`/api/admin/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }, endpoint.generation),
    'Memory deletion'
  )
  return readUarOperations()
}

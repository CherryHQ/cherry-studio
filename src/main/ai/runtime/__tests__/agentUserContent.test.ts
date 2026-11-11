import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
let root: string
let notesRoot: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-notes-'))
  notesRoot = path.join(root, 'notes')
  await mkdir(notesRoot)
  vi.spyOn(application, 'getPath').mockReturnValue(notesRoot)
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', '')
  await writeFile(path.join(notesRoot, 'note.md'), 'current note')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentUserContent } from '../agentUserContent'

function message(parts: CherryMessagePart[]): AgentSessionMessageEntity {
  return { data: { parts } } as unknown as AgentSessionMessageEntity
}

function filePart(url: string, filename?: string): CherryMessagePart {
  return { type: 'file', url, mediaType: 'image/jpeg', filename } as unknown as CherryMessagePart
}

describe('buildAgentUserContent', () => {
  it('delivers original filenames alongside local attachment paths', async () => {
    const firstUrl = 'file:///C:/managed/uuid-a'
    const secondUrl = 'file:///C:/managed/uuid-b'
    const content = await buildAgentUserContent(
      message([
        { type: 'text', text: 'Classify these images.' },
        filePart(firstUrl, '20260406_184133 Alex Diaz.jpg'),
        filePart(secondUrl, 'scan "final".jpg')
      ])
    )

    expect(content).toContain('Attached files (read them with your tools using these absolute paths):')
    expect(content).toContain(`- ${JSON.stringify('20260406_184133 Alex Diaz.jpg')}: ${fileURLToPath(firstUrl)}`)
    expect(content).toContain(`- ${JSON.stringify('scan "final".jpg')}: ${fileURLToPath(secondUrl)}`)
  })

  it('keeps path-only output for legacy file parts without a filename', async () => {
    const url = 'file:///C:/managed/uuid-legacy'
    const content = await buildAgentUserContent(message([filePart(url)]))

    expect(content).toContain(`- ${fileURLToPath(url)}`)
    expect(content).not.toContain(`- ${JSON.stringify(fileURLToPath(url))}:`)
  })
})

it('announces a marked note source rather than its managed copy', async () => {
  const part = {
    ...filePart('file:///managed/copy', 'note.md'),
    providerMetadata: {
      cherry: { noteReference: true, originalPath: path.join(notesRoot, 'note.md') }
    }
  } as CherryMessagePart
  const content = await buildAgentUserContent(message([part]))
  expect(content).toContain(path.join(notesRoot, 'note.md'))
  expect(content).not.toContain('/managed/copy')
})

it('marks a deleted note source unavailable', async () => {
  const source = path.join(notesRoot, 'note.md')
  await rm(source)
  const part = {
    ...filePart('file:///managed/copy', 'note.md'),
    providerMetadata: { cherry: { noteReference: true, originalPath: source } }
  } as CherryMessagePart
  const content = await buildAgentUserContent(message([part]))
  expect(content).toContain('Unavailable attachments: note.md')
  expect(content).not.toContain(source)
})

it('marks a note source outside the notes root unavailable', async () => {
  const source = path.join(root, 'outside-note.md')
  await writeFile(source, 'outside')
  const part = {
    ...filePart('file:///managed/copy', 'note.md'),
    providerMetadata: { cherry: { noteReference: true, originalPath: source } }
  } as CherryMessagePart
  const content = await buildAgentUserContent(message([part]))
  expect(content).toContain('Unavailable attachments: note.md')
  expect(content).not.toContain(source)
})

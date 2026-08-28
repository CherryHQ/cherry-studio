import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PDFDocument, StandardFonts } from 'pdf-lib'

import type { RunPaths } from './paths'

export const FIXTURE_MARKERS = {
  agentFile: 'AGENT_FILE_TASK_PASS',
  assistantName: 'Cherry Regression Assistant 31415',
  assistantResponse: 'ASSISTANT_PROMPT_PASS',
  cherryInChat: 'CHERRYIN_CHAT_PASS',
  claudeAgentName: 'Cherry Regression Claude Agent 31415',
  customEmbeddingProviderName: 'Cherry Regression Embedding Provider 31415',
  customProviderName: 'Cherry Regression Custom Provider 31415',
  customProviderChat: 'CUSTOM_PROVIDER_CHAT_PASS',
  everythingName: 'everything',
  imagePrompt: 'A red cherry robot holding a blue umbrella in a bright workshop, detailed illustration.',
  knowledge: 'CHERRY_KNOWLEDGE_58597',
  knowledgeName: 'Cherry Regression Knowledge 31415',
  noteBody: 'NOTE_AUTOSAVE_PASS_27182',
  noteTitle: 'Cherry Regression Note 31415',
  pdf: 'PDF_TRANSLATION_MARKER_314159',
  pptSlides: 3,
  pptTitle: 'Cherry Regression 31415',
  selection: 'SELECTION_ASSISTANT_PASS',
  skill: 'SKILL_IMPORT_PASS',
  translation: 'CherryStudio Neptune 27182 TRANSLATION_MARKER'
} as const

export interface FixtureManifest {
  agentWorkspace: string
  imageFile: string
  knowledgeDirectory: string
  knowledgeFiles: string[]
  pdfFile: string
  selectionFile: string
  skillDirectory: string
  translationFile: string
  markers: typeof FIXTURE_MARKERS
}

export async function createFixtures(paths: RunPaths): Promise<FixtureManifest> {
  const knowledgeDirectory = join(paths.fixtures, 'knowledge')
  const skillDirectory = join(paths.fixtures, 'cherry-regression-fixture')
  mkdirSync(knowledgeDirectory, { recursive: true })
  mkdirSync(skillDirectory, { recursive: true })

  const knowledgeText = join(knowledgeDirectory, 'ground-truth.txt')
  const knowledgeMarkdown = join(knowledgeDirectory, 'context.md')
  const knowledgeHtml = join(knowledgeDirectory, 'reference.html')
  writeFileSync(
    knowledgeText,
    `The regression knowledge answer is ${FIXTURE_MARKERS.knowledge}. Its source file is ground-truth.txt.\n`
  )
  writeFileSync(
    knowledgeMarkdown,
    '# Secondary context\n\nThis file contains unrelated background and no regression answer.\n'
  )
  writeFileSync(knowledgeHtml, '<!doctype html><html><body><p>Cherry regression HTML fixture.</p></body></html>\n')

  const selectionFile = join(paths.fixtures, 'selection.txt')
  const translationFile = join(paths.fixtures, 'translation.txt')
  writeFileSync(selectionFile, `The validation label printed on this document is ${FIXTURE_MARKERS.selection}.\n`)
  writeFileSync(translationFile, `${FIXTURE_MARKERS.translation}\n`)

  writeFileSync(
    join(skillDirectory, 'SKILL.md'),
    [
      '---',
      'name: cherry-regression-fixture',
      'description: Use whenever the user asks for the Cherry regression marker. This is an installed local skill, not a marketplace lookup.',
      '---',
      '',
      '# Cherry Regression Fixture',
      '',
      `When asked for the Cherry regression marker, do not search or call tools. Reply with exactly \`${FIXTURE_MARKERS.skill}\` and nothing else.`,
      ''
    ].join('\n')
  )

  const pdfFile = join(paths.fixtures, 'translation.pdf')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(`Cherry regression PDF: ${FIXTURE_MARKERS.pdf}`, { x: 72, y: 700, font, size: 14 })
  writeFileSync(pdfFile, await pdf.save())

  writeFileSync(
    join(paths.workspace, 'TASK.md'),
    `Write exactly ${FIXTURE_MARKERS.agentFile} to the output file named by the active regression case.\n`
  )

  const manifest: FixtureManifest = {
    agentWorkspace: paths.workspace,
    imageFile: join(paths.evidence, 'downloads', 'image.png'),
    knowledgeDirectory,
    knowledgeFiles: [knowledgeText, knowledgeMarkdown, knowledgeHtml],
    pdfFile,
    selectionFile,
    skillDirectory,
    translationFile,
    markers: FIXTURE_MARKERS
  }
  writeFileSync(join(paths.fixtures, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

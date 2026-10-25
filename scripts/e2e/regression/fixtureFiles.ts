import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'

import type { RunPaths } from './paths'

export const FIXTURE_MARKERS = {
  agentFile: 'AGENT_FILE_TASK_PASS',
  knowledge: 'CHERRY_KNOWLEDGE_58597',
  pdf: 'PDF_TRANSLATION_MARKER_314159',
  selection: 'SELECTION_ASSISTANT_PASS',
  skill: 'SKILL_IMPORT_PASS',
  translation: 'CherryStudio Neptune 27182 TRANSLATION_MARKER'
} as const

export async function createFixtures(paths: RunPaths): Promise<void> {
  const documents = join(paths.fixtures, 'documents')
  const images = join(paths.fixtures, 'images')
  const vault = join(paths.fixtures, 'imports', 'obsidian-vault')
  const edge = join(paths.fixtures, 'edge')
  const translationDocuments = join(paths.fixtures, 'translation-documents')
  for (const directory of [documents, images, vault, edge, translationDocuments])
    mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(documents, 'sample-chinese.md'),
    '# 樱桃工作室产品手册（测试用）\n\n## 一、产品定位\nCherry Studio 是一款面向创造者的多模型 AI 桌面客户端，支持接入多家模型服务商，\n把对话、智能体、知识库、笔记、翻译、绘画放在同一个工作台里。\n\n## 二、核心能力\n1. 多服务商管理：OpenAI、Anthropic、Gemini、DeepSeek 等，可自定义 Base URL。\n2. 多话题对话：同一助手下可开多个话题，消息本地落库，重启后可继续。\n3. 知识库检索：支持文件、目录、链接、笔记四类数据源，按 Top K 召回后拼进上下文。\n4. 智能体：可指定工作目录、权限模式，执行读写文件与命令类任务。\n5. 笔记：Markdown 编辑器，可导出 PDF/Word，也可作为知识库数据源。\n\n## 三、常见问题\n- 首次启动会引导选择语言与主题，服务商可以稍后设置。\n- 图片模型与语音模型需要单独下载或授权。\n- 数据默认保存在应用数据目录，可在设置中备份与恢复。\n\n## 四、版本信息\n| 版本 | 日期 | 说明 |\n|---|---|---|\n| 2.1.5 | 2026-09-20 | 知识库数据源表重构 |\n| 2.1.6 | 2026-10-05 | 引入本地 API Gateway |\n| 2.1.7 | 2026-10-14 | 智能体右侧预览面板 |\n\n## 五、代码示例\n```python\ndef recall(query: str, top_k: int = 5) -> list[str]:\n    return vector_store.search(query, top_k=top_k)\n```\n\n> 备注：本文档用于知识库召回、笔记编辑与翻译用例，内容可自由修改。\n'
  )
  const note = `# Weekly note

See [sample](${pathToFileURL(join(documents, 'sample-chinese.md')).href}).
`
  const vaultNote = `# Vault welcome

See [sample](${pathToFileURL(join(documents, 'sample-chinese.md')).href}).
`
  writeFileSync(join(documents, 'sample-note.md'), note)
  writeFileSync(join(vault, 'Welcome.md'), vaultNote)
  writeFileSync(join(documents, 'unsupported.bin'), 'Unsupported directory import fixture')
  writeFileSync(
    join(translationDocuments, 'sample-chinese.md'),
    '# 春日旅行\n\n今天我们一起去公园散步，欣赏盛开的鲜花。\n\n## 旅行计划\n\n明天我们将参观博物馆，了解这座城市的历史。\n'
  )
  writeFileSync(join(edge, '中文 文件名 带空格.txt'), '中文附件内容 CHINESE_ATTACHMENT_MARKER\n')
  writeFileSync(join(edge, 'long-text-20k.txt'), 'Long attachment text. '.repeat(1100))
  writeFileSync(join(edge, 'unsupported.exe'), 'MP33_REJECTED_BINARY_CONTENT')
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="white"/><g font-family="Arial" font-size="48" fill="black"><text x="60" y="140">The red apple is on the table.</text><text x="60" y="240">There are seven blue books.</text></g></svg>'
    )
  )
    .png()
    .toFile(join(images, 'sample.png'))

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
      'description: Local reference for the Cherry regression fixture catalog and its validation label.',
      '---',
      '',
      '# Cherry Regression Fixture',
      '',
      'Use this reference to answer questions about the fixture catalog. Quote field values verbatim.',
      '',
      '| Field | Value |',
      '| --- | --- |',
      '| Catalog | Cherry regression fixture |',
      `| Validation label | ${FIXTURE_MARKERS.skill} |`,
      ''
    ].join('\n')
  )

  const pdfFile = join(paths.fixtures, 'translation.pdf')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(`Cherry regression PDF: ${FIXTURE_MARKERS.pdf}`, { x: 72, y: 700, font, size: 14 })
  const pdfBytes = await pdf.save()
  writeFileSync(pdfFile, pdfBytes)
  writeFileSync(join(documents, 'sample.pdf'), pdfBytes)

  writeFileSync(
    join(paths.workspace, 'TASK.md'),
    `Write exactly ${FIXTURE_MARKERS.agentFile} to the output file named by the active regression case.\n`
  )
}

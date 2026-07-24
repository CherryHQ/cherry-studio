import path from 'node:path'

import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'

import { renderCherryPptx } from '../cherryPpt'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..')
const TEMPLATE_DIRECTORY = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-ppt/assets/templates'
)
const signal = new AbortController().signal

function buildSpec(template: 'red' | 'enterprise-blue' | 'young' | 'cy2k') {
  const formal = template === 'red' || template === 'enterprise-blue'
  return {
    template,
    slides: [
      {
        layout: 'cover',
        title: 'Cherry-PPT',
        subtitle: 'Template demo',
        author: 'Cherry Studio',
        date: '2026 / 07'
      },
      {
        layout: 'agenda',
        items: [
          { title: 'Plan', description: 'Define the story' },
          { title: 'Build', description: 'Map the layouts' },
          { title: 'Review', description: 'Check the output' },
          { title: 'Deliver', description: 'Share the deck' },
          ...(formal ? [] : [{ title: 'Improve', description: 'Apply feedback' }])
        ]
      },
      {
        layout: 'section',
        number: template === 'cy2k' ? '1' : '01',
        title: 'Template Engine',
        subtitle: formal ? '' : 'Editable by default'
      },
      {
        layout: 'content',
        section: 'CHERRY-PPT',
        title: 'Native template',
        points: [
          { label: '01', title: 'Preserve', body: 'Keep the source master and layouts.' },
          { label: '02', title: 'Replace', body: 'Edit named content slots in place.' },
          { label: '03', title: 'Validate', body: 'Reject copy that cannot fit safely.' }
        ],
        takeaway: 'The final deck remains editable.',
        source: 'Source: Cherry Studio',
        pageNumber: '04 / 05'
      },
      {
        layout: 'closing',
        title: 'Thank you',
        subtitle: 'Created with Cherry-PPT',
        contact: 'CHERRYAI.COM.CN'
      }
    ]
  }
}

function activeSlideCount(zip: AdmZip): number {
  const presentation = zip.readAsText('ppt/presentation.xml')
  return presentation.match(/<p:sldId\s/g)?.length ?? 0
}

function assertRelationshipsResolve(zip: AdmZip): void {
  const names = new Set(zip.getEntries().map((entry) => entry.entryName))

  for (const entry of zip.getEntries().filter(({ entryName }) => entryName.endsWith('.rels'))) {
    const relationships =
      entry
        .getData()
        .toString('utf8')
        .match(/<Relationship\b[^>]*\/?\s*>/g) ?? []
    const baseDirectory = path.posix.dirname(path.posix.dirname(entry.entryName))

    for (const relationship of relationships) {
      if (/TargetMode="External"/.test(relationship)) continue
      const target = /Target="([^"]+)"/.exec(relationship)?.[1]
      if (!target) continue
      const resolved = path.posix.normalize(path.posix.join(baseDirectory, target.replace(/^\//, '')))
      expect(names.has(resolved), `${entry.entryName} points to missing ${resolved}`).toBe(true)
    }
  }
}

function emptySlidePlaceholders(zip: AdmZip): string[] {
  return zip
    .getEntries()
    .filter(({ entryName }) => /^ppt\/slides\/slide\d+\.xml$/.test(entryName))
    .flatMap((entry) => {
      const xml = entry.getData().toString('utf8')
      return [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)]
        .map(([, shape]) => shape)
        .filter((shape) => shape.includes('<p:ph'))
        .filter((shape) => ![...shape.matchAll(/<a:t>(.*?)<\/a:t>/g)].some(([, text]) => text.trim()))
        .map((shape) => /<p:cNvPr[^>]*name="([^"]*)"/.exec(shape)?.[1] ?? entry.entryName)
    })
}

describe('renderCherryPptx', () => {
  it.each([
    ['red', 5],
    ['enterprise-blue', 5],
    ['young', 8],
    ['cy2k', 8]
  ] as const)('renders the %s template with its master and layouts intact', async (template, layoutCount) => {
    const output = await renderCherryPptx(JSON.stringify(buildSpec(template)), TEMPLATE_DIRECTORY, signal)
    const zip = new AdmZip(Buffer.from(output))
    const entries = zip.getEntries().map((entry) => entry.entryName)
    const slideXml = zip
      .getEntries()
      .filter(({ entryName }) => /^ppt\/slides\/slide\d+\.xml$/.test(entryName))
      .map((entry) => entry.getData().toString('utf8'))
      .join('\n')

    expect(activeSlideCount(zip)).toBe(5)
    expect(entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(5)
    expect(entries.filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))).toHaveLength(1)
    expect(entries.filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))).toHaveLength(layoutCount)
    expect(slideXml).toContain('Cherry-PPT')
    expect(slideXml).toContain('Native template')
    expect(slideXml).toContain('Thank you')
    expect(slideXml).not.toMatch(/{{[^}]+}}/)
    expect(slideXml).not.toContain('Y2K DIGITAL FUTURE')
    assertRelationshipsResolve(zip)
  })

  it('rejects malformed JSON before creating a presentation', async () => {
    await expect(renderCherryPptx('{broken', TEMPLATE_DIRECTORY, signal)).rejects.toThrow(/valid JSON/i)
  })

  it('removes unused optional placeholders from minimal slides', async () => {
    const output = await renderCherryPptx(
      JSON.stringify({
        template: 'young',
        slides: [
          { layout: 'cover', title: 'Cherry-PPT' },
          { layout: 'agenda', items: [{ title: 'Plan' }] },
          { layout: 'section', number: '01', title: 'Plan' },
          { layout: 'content', title: 'Plan', points: [{ title: 'First' }] },
          { layout: 'closing', title: 'Done' }
        ]
      }),
      TEMPLATE_DIRECTORY,
      signal
    )
    const zip = new AdmZip(Buffer.from(output))

    expect(emptySlidePlaceholders(zip)).toEqual([])
    assertRelationshipsResolve(zip)
  })

  it('rejects copy that cannot fit the selected template', async () => {
    const spec = buildSpec('young')
    spec.slides[0] = {
      layout: 'cover',
      title: 'Cherry-PPT',
      subtitle: 'This subtitle is deliberately too long for the narrow Young template slot',
      author: '',
      date: ''
    }

    await expect(renderCherryPptx(JSON.stringify(spec), TEMPLATE_DIRECTORY, signal)).rejects.toThrow(
      /slides\[0\]\.subtitle is too long/i
    )
  })

  it.each(['red', 'enterprise-blue', 'young'] as const)(
    'rejects a mixed-script cover title that wraps in the %s template',
    async (template) => {
      const spec = buildSpec(template)
      spec.slides[0] = {
        layout: 'cover',
        title: 'Cherry-PPT 模板能力',
        subtitle: '',
        author: '',
        date: ''
      }

      await expect(renderCherryPptx(JSON.stringify(spec), TEMPLATE_DIRECTORY, signal)).rejects.toThrow(
        /slides\[0\]\.title is too long/i
      )
    }
  )

  it.each(['red', 'enterprise-blue', 'young'] as const)(
    'rejects a content title that wraps in the %s template',
    async (template) => {
      const spec = buildSpec(template)
      const content = spec.slides[3]
      if (content.layout !== 'content') throw new Error('Expected content fixture')
      content.title = '模板内容按原有插槽替换'

      await expect(renderCherryPptx(JSON.stringify(spec), TEMPLATE_DIRECTORY, signal)).rejects.toThrow(
        /slides\[3\]\.title is too long/i
      )
    }
  )

  it('rejects a two-character CY2K section number', async () => {
    const spec = buildSpec('cy2k')
    const section = spec.slides[2]
    if (section.layout !== 'section') throw new Error('Expected section fixture')
    section.number = '01'

    await expect(renderCherryPptx(JSON.stringify(spec), TEMPLATE_DIRECTORY, signal)).rejects.toThrow(
      /slides\[2\]\.number is too long/i
    )
  })

  it('rejects a fifth agenda item in formal templates', async () => {
    const spec = buildSpec('red')
    const agenda = spec.slides[1]
    if (agenda.layout !== 'agenda' || !agenda.items) throw new Error('Expected agenda fixture')
    agenda.items.push({ title: 'Extra', description: 'Does not fit' })

    await expect(renderCherryPptx(JSON.stringify(spec), TEMPLATE_DIRECTORY, signal)).rejects.toThrow(
      /supports at most 4 entries/i
    )
  })
})

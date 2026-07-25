import path from 'node:path'

import Automizer, { type ISlide, ModifyTextHelper } from 'pptx-automizer'
import * as z from 'zod'

const requiredText = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional().default('')

const coverSlideSchema = z
  .object({
    layout: z.literal('cover'),
    title: requiredText(120),
    subtitle: optionalText(160),
    author: optionalText(80),
    date: optionalText(40)
  })
  .strict()

const sectionSlideSchema = z
  .object({
    layout: z.literal('section'),
    number: requiredText(16),
    title: requiredText(100),
    subtitle: optionalText(140)
  })
  .strict()

const agendaItemSchema = z
  .object({
    title: requiredText(80),
    description: optionalText(120)
  })
  .strict()

const agendaSlideSchema = z
  .object({
    layout: z.literal('agenda'),
    items: z.array(agendaItemSchema).min(1).max(5)
  })
  .strict()

const contentPointSchema = z
  .object({
    label: optionalText(16),
    title: requiredText(80),
    body: optionalText(180)
  })
  .strict()

const contentSlideSchema = z
  .object({
    layout: z.literal('content'),
    section: optionalText(40),
    title: requiredText(120),
    points: z.array(contentPointSchema).min(1).max(3),
    takeaway: optionalText(160),
    source: optionalText(160),
    pageNumber: optionalText(24)
  })
  .strict()

const closingSlideSchema = z
  .object({
    layout: z.literal('closing'),
    title: requiredText(80),
    subtitle: optionalText(120),
    contact: optionalText(80)
  })
  .strict()

const cherryPptSpecSchema = z
  .object({
    template: z.enum(['red', 'enterprise-blue', 'young', 'cy2k']),
    slides: z
      .array(
        z.discriminatedUnion('layout', [
          coverSlideSchema,
          sectionSlideSchema,
          agendaSlideSchema,
          contentSlideSchema,
          closingSlideSchema
        ])
      )
      .min(1)
      .max(40)
  })
  .strict()

type CherryPptSpec = z.infer<typeof cherryPptSpecSchema>
type CherryPptSlide = CherryPptSpec['slides'][number]
type ContentSlide = z.infer<typeof contentSlideSchema>

type TemplateFamily = 'formal' | 'young' | 'cy2k'

interface TemplateConfig {
  filename: string
  family: TemplateFamily
  agendaSize: 4 | 5
  sourceSlides: Record<CherryPptSlide['layout'], number>
}

const TEMPLATE_CONFIGS: Record<CherryPptSpec['template'], TemplateConfig> = {
  red: {
    filename: 'red.pptx',
    family: 'formal',
    agendaSize: 4,
    sourceSlides: { cover: 1, section: 2, agenda: 3, content: 4, closing: 5 }
  },
  'enterprise-blue': {
    filename: 'enterprise-blue.pptx',
    family: 'formal',
    agendaSize: 4,
    sourceSlides: { cover: 1, section: 2, agenda: 3, content: 4, closing: 5 }
  },
  young: {
    filename: 'young.pptx',
    family: 'young',
    agendaSize: 5,
    sourceSlides: { cover: 1, section: 2, agenda: 3, content: 4, closing: 8 }
  },
  cy2k: {
    filename: 'cy2k.pptx',
    family: 'cy2k',
    agendaSize: 5,
    sourceSlides: { cover: 1, section: 2, agenda: 3, content: 4, closing: 8 }
  }
}

let renderQueue: Promise<void> = Promise.resolve()

function visualUnits(value: string): number {
  let units = 0
  for (const character of value) {
    units += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character) ? 2 : 1
  }
  return units
}

function assertFits(value: string, limit: number, field: string, template: CherryPptSpec['template']): void {
  const units = visualUnits(value)
  if (units > limit) {
    throw new Error(`${field} is too long for Cherry-PPT template ${template}: ${units} > ${limit} visual units`)
  }
}

function familyLimit(family: TemplateFamily, formal: number, young: number, cy2k: number): number {
  if (family === 'formal') return formal
  return family === 'young' ? young : cy2k
}

function validateCopy(spec: CherryPptSpec): void {
  const config = TEMPLATE_CONFIGS[spec.template]

  for (const [index, slide] of spec.slides.entries()) {
    const field = (name: string) => `slides[${index}].${name}`

    switch (slide.layout) {
      case 'cover':
        assertFits(slide.title, familyLimit(config.family, 12, 12, 19), field('title'), spec.template)
        assertFits(slide.subtitle, familyLimit(config.family, 16, 16, 36), field('subtitle'), spec.template)
        assertFits(slide.author, familyLimit(config.family, 14, 15, 17), field('author'), spec.template)
        assertFits(slide.date, 10, field('date'), spec.template)
        break
      case 'section':
        assertFits(slide.number, familyLimit(config.family, 12, 2, 1), field('number'), spec.template)
        assertFits(slide.title, familyLimit(config.family, 23, 23, 17), field('title'), spec.template)
        assertFits(slide.subtitle, familyLimit(config.family, 1, 29, 44), field('subtitle'), spec.template)
        if (config.family === 'formal' && slide.subtitle) {
          throw new Error(`${field('subtitle')} is not supported by Cherry-PPT template ${spec.template}`)
        }
        if (config.family === 'cy2k' && [...slide.number].length !== 1) {
          throw new Error(`${field('number')} must be one character for Cherry-PPT template ${spec.template}`)
        }
        break
      case 'agenda':
        if (slide.items.length > config.agendaSize) {
          throw new Error(
            `${field('items')} supports at most ${config.agendaSize} entries for template ${spec.template}`
          )
        }
        for (const [itemIndex, item] of slide.items.entries()) {
          assertFits(
            item.title,
            familyLimit(config.family, 28, 31, 31),
            `${field('items')}[${itemIndex}].title`,
            spec.template
          )
          assertFits(
            item.description,
            familyLimit(config.family, 26, 31, 31),
            `${field('items')}[${itemIndex}].description`,
            spec.template
          )
          if (config.family !== 'formal') {
            assertFits(
              item.description ? `${item.title} - ${item.description}` : item.title,
              31,
              `${field('items')}[${itemIndex}]`,
              spec.template
            )
          }
        }
        break
      case 'content': {
        assertFits(slide.section, familyLimit(config.family, 23, 23, 30), field('section'), spec.template)
        assertFits(slide.title, familyLimit(config.family, 19, 19, 38), field('title'), spec.template)
        assertFits(slide.source, familyLimit(config.family, 24, 24, 38), field('source'), spec.template)
        assertFits(slide.pageNumber, familyLimit(config.family, 16, 16, 7), field('pageNumber'), spec.template)
        assertFits(slide.takeaway, familyLimit(config.family, 90, 90, 70), field('takeaway'), spec.template)

        for (const [pointIndex, point] of slide.points.entries()) {
          assertFits(point.label, 8, `${field('points')}[${pointIndex}].label`, spec.template)
          assertFits(
            point.title,
            familyLimit(config.family, 42, 42, 24),
            `${field('points')}[${pointIndex}].title`,
            spec.template
          )
          assertFits(
            point.body,
            config.family === 'cy2k' ? 58 : 110,
            `${field('points')}[${pointIndex}].body`,
            spec.template
          )
        }

        if (config.family !== 'cy2k') {
          const bullets = contentBullets(slide).join(' ')
          assertFits(bullets, 220, field('points'), spec.template)
        }
        break
      }
      case 'closing':
        assertFits(slide.title, familyLimit(config.family, 19, 19, 10), field('title'), spec.template)
        assertFits(slide.subtitle, familyLimit(config.family, 24, 24, 40), field('subtitle'), spec.template)
        assertFits(slide.contact, familyLimit(config.family, 22, 23, 21), field('contact'), spec.template)
        break
    }
  }
}

function setText(slide: ISlide, shapeName: string, value: string): void {
  if (!value) {
    slide.removeElement(shapeName)
    return
  }
  slide.modifyElement(shapeName, ModifyTextHelper.setText(value))
}

function setBullets(slide: ISlide, shapeName: string, values: string[]): void {
  slide.modifyElement(shapeName, ModifyTextHelper.setBulletList(values))
}

function formatPoint(point: ContentSlide['points'][number]): string {
  const title = point.label ? `${point.label} ${point.title}` : point.title
  return point.body ? `${title}: ${point.body}` : title
}

function contentBullets(spec: ContentSlide): string[] {
  const bullets = spec.points.map(formatPoint)
  if (spec.takeaway) bullets.push(`Takeaway: ${spec.takeaway}`)
  return bullets
}

function applyCover(slide: ISlide, spec: Extract<CherryPptSlide, { layout: 'cover' }>): void {
  setText(slide, 'cover-title-slot Placeholder Carrier', spec.title)
  setText(slide, 'cover-subtitle-slot Placeholder Carrier', spec.subtitle)
  setText(slide, 'cover-author-slot Placeholder Carrier', spec.author)
  setText(slide, 'cover-date-slot Placeholder Carrier', spec.date)
}

function applySection(
  slide: ISlide,
  spec: Extract<CherryPptSlide, { layout: 'section' }>,
  family: TemplateFamily
): void {
  if (family === 'young') {
    setText(slide, 'section-number-slot Placeholder Carrier', spec.number)
    setText(slide, 'section-title-slot Placeholder Carrier', spec.title)
    setText(slide, 'section-subtitle-slot Placeholder Carrier', spec.subtitle)
    return
  }

  setText(slide, 'chapter-number-slot Placeholder Carrier', spec.number)
  setText(slide, 'chapter-title-slot Placeholder Carrier', spec.title)
  if (family === 'cy2k') setText(slide, 'chapter-subtitle-slot Placeholder Carrier', spec.subtitle)
}

function applyAgenda(slide: ISlide, spec: Extract<CherryPptSlide, { layout: 'agenda' }>, config: TemplateConfig): void {
  for (let index = 0; index < config.agendaSize; index += 1) {
    const item = spec.items[index]
    if (config.family === 'formal') {
      setText(slide, `toc-item-${index + 1}-title-slot Placeholder Carrier`, item?.title ?? '')
      setText(slide, `toc-item-${index + 1}-desc-slot Placeholder Carrier`, item?.description ?? '')
    } else {
      const value = item ? (item.description ? `${item.title} - ${item.description}` : item.title) : ''
      setText(slide, `agenda-item-${index + 1}-slot Placeholder Carrier`, value)
    }
  }
}

function applyCy2kContent(slide: ISlide, spec: ContentSlide): void {
  const slots = [
    { label: 'TextBox 12', title: 'TextBox 13', body: 'TextBox 14', overflow: 'TextBox 15' },
    { label: 'Rectangle 16', title: 'TextBox 18', body: 'TextBox 19', overflow: 'TextBox 20' },
    { label: 'Rectangle 21', title: 'TextBox 23', body: 'TextBox 24', overflow: 'TextBox 25' }
  ]

  for (const [index, slot] of slots.entries()) {
    const point = spec.points[index]
    setText(slide, slot.label, point ? point.label || String(index + 1).padStart(2, '0') : '')
    setText(slide, slot.title, point?.title ?? '')
    setText(slide, slot.body, point?.body ?? '')
    setText(slide, slot.overflow, '')
  }

  setText(slide, 'Rectangle 26', spec.takeaway ? 'KEY TAKEAWAY' : '')
  setText(slide, 'TextBox 29', spec.takeaway)
}

function applyContent(slide: ISlide, spec: ContentSlide, family: TemplateFamily): void {
  setText(slide, 'content-section-slot Placeholder Carrier', spec.section)
  setText(slide, 'content-title-slot Placeholder Carrier', spec.title)

  if (family === 'formal') {
    setBullets(slide, 'content-body-slot Placeholder Carrier', contentBullets(spec))
    setText(slide, 'content-page-number-slot Placeholder Carrier', spec.pageNumber)
  } else if (family === 'young') {
    setBullets(slide, 'TextBox 13', contentBullets(spec))
    setText(slide, 'content-page-number-slot Placeholder Carrier', spec.pageNumber)
  } else {
    applyCy2kContent(slide, spec)
    setText(slide, 'content-page-slot Placeholder Carrier', spec.pageNumber)
  }

  setText(slide, 'content-source-slot Placeholder Carrier', spec.source)
}

function applyClosing(
  slide: ISlide,
  spec: Extract<CherryPptSlide, { layout: 'closing' }>,
  family: TemplateFamily
): void {
  const prefix = family === 'formal' ? 'closing' : 'ending'
  setText(slide, `${prefix}-title-slot Placeholder Carrier`, spec.title)
  setText(slide, `${prefix}-subtitle-slot Placeholder Carrier`, spec.subtitle)
  setText(slide, `${prefix}-contact-slot Placeholder Carrier`, spec.contact)
}

function applySlide(slide: ISlide, spec: CherryPptSlide, config: TemplateConfig): void {
  switch (spec.layout) {
    case 'cover':
      applyCover(slide, spec)
      break
    case 'section':
      applySection(slide, spec, config.family)
      break
    case 'agenda':
      applyAgenda(slide, spec, config)
      break
    case 'content':
      applyContent(slide, spec, config.family)
      break
    case 'closing':
      applyClosing(slide, spec, config.family)
      break
  }
}

function sourcePartForRelationships(relationshipsPath: string): string | undefined {
  if (relationshipsPath === '_rels/.rels') return undefined
  const relationshipsDirectory = path.posix.dirname(relationshipsPath)
  const sourceDirectory = path.posix.dirname(relationshipsDirectory)
  return path.posix.join(sourceDirectory, path.posix.basename(relationshipsPath, '.rels'))
}

async function removeUnusedDanglingRelationships(archive: Awaited<ReturnType<Automizer['getJSZip']>>): Promise<void> {
  const filenames = new Set(Object.keys(archive.files))

  for (const relationshipsPath of [...filenames].filter((filename) => filename.endsWith('.rels'))) {
    const relationshipsFile = archive.file(relationshipsPath)
    if (!relationshipsFile) continue

    const sourcePart = sourcePartForRelationships(relationshipsPath)
    const sourceXml = sourcePart ? await archive.file(sourcePart)?.async('string') : undefined
    const relationshipsXml = await relationshipsFile.async('string')
    const cleaned = relationshipsXml.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
      if (/TargetMode="External"/.test(relationship)) return relationship
      const target = /Target="([^"]+)"/.exec(relationship)?.[1]
      const id = /Id="([^"]+)"/.exec(relationship)?.[1]
      if (!target || !id) return relationship

      const baseDirectory = sourcePart ? path.posix.dirname(sourcePart) : ''
      const resolvedTarget = path.posix.normalize(path.posix.join(baseDirectory, target.replace(/^\//, '')))
      if (filenames.has(resolvedTarget)) return relationship

      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (sourceXml && new RegExp(`r:(?:id|embed|link)="${escapedId}"`).test(sourceXml)) {
        throw new Error(`${sourcePart} references missing Cherry-PPT relationship target ${resolvedTarget}`)
      }
      return ''
    })

    if (cleaned !== relationshipsXml) archive.file(relationshipsPath, cleaned)
  }
}

async function renderLocked(spec: CherryPptSpec, templateDirectory: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const config = TEMPLATE_CONFIGS[spec.template]
  const presentation = new Automizer({
    templateDir: templateDirectory,
    removeExistingSlides: true,
    autoImportSlideMasters: false,
    cleanup: true,
    cleanupPlaceholders: false,
    verbosity: 0
  })
    .loadRoot(config.filename)
    .load(config.filename, 'template')

  for (const slideSpec of spec.slides) {
    presentation.addSlide('template', config.sourceSlides[slideSpec.layout], (slide) => {
      applySlide(slide, slideSpec, config)
    })
  }

  const archive = await presentation.getJSZip()
  await removeUnusedDanglingRelationships(archive)
  signal.throwIfAborted()
  return archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}

async function withRenderLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = renderQueue
  let release!: () => void
  renderQueue = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

export async function renderCherryPptx(
  source: string,
  templateDirectory: string,
  signal: AbortSignal
): Promise<Uint8Array> {
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch (error) {
    throw new Error('Cherry-PPT source must be valid JSON', { cause: error })
  }

  const spec = cherryPptSpecSchema.parse(json)
  validateCopy(spec)

  return withRenderLock(() => renderLocked(spec, path.resolve(templateDirectory), signal))
}

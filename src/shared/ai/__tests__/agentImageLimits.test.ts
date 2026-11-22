import { describe, expect, it } from 'vitest'

import { ModelSchema, type Model } from '@shared/data/types/model'
import { withCherryMeta } from '@shared/data/types/uiParts'

import {
  AgentImageLimitError,
  assertAgentImageLimit,
  assertClaudeAgentImageLimit,
  assertRoutedAgentImageLimit,
  assertRuntimeAgentImageLimit,
  canBeClaudeNativeImagePart,
  countAgentImageAttachments,
  countAgentImageFileParts,
  countClaudeNativeFileParts,
  countClaudeNativeImageAttachments,
  countClaudeNativeImageParts,
  countRoutedAgentImageFileParts,
  isAgentImagePart,
  isManualCompactParts,
  normalizeAgentImageLimitFailure,
  parseUpstreamImageLimit,
  resolveMaxAgentImages
} from '../agentImageLimits'

function visionModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test::vision-model',
    providerId: 'test',
    name: 'Vision Model',
    capabilities: ['image-recognition'],
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true,
    ...overrides
  } as unknown as Model
}

describe('isAgentImagePart', () => {
  it('accepts declared image media types', () => {
    expect(isAgentImagePart({ type: 'file', mediaType: 'image/png' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', mediaType: 'IMAGE/JPEG' })).toBe(true)
  })

  it('accepts composer FILE_TYPE image markers', () => {
    expect(isAgentImagePart({ type: 'image', ext: '.png', name: 'shot' })).toBe(true)
  })

  it('accepts image data URLs', () => {
    expect(isAgentImagePart({ type: 'file', url: 'data:image/png;base64,AQID' })).toBe(true)
  })

  it('accepts known image extensions on ext, filename and file URL', () => {
    expect(isAgentImagePart({ type: 'image', ext: '.JPG' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', filename: 'scan "final".PNG' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', url: 'file:///tmp/photo.webp?x=1#y' })).toBe(true)
  })

  it('counts AVIF/HEIC/TIFF by extension like main does by MIME (#20030)', () => {
    // Renderer attachments lack MIME; main counts image/avif by MIME after the
    // bridge. Both sides must agree before managed copies are created.
    expect(isAgentImagePart({ type: 'file', filename: 'shot.avif' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', filename: 'shot.heic' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', ext: '.avif', name: 'out-of-workspace' })).toBe(true)
    expect(countAgentImageFileParts([{ type: 'file', filename: 'a.avif' }])).toBe(1)
  })

  it('rejects non-image parts', () => {
    expect(isAgentImagePart({ type: 'file', mediaType: 'video/mp4', filename: 'clip.mp4' })).toBe(false)
    expect(isAgentImagePart({ type: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' })).toBe(false)
    expect(isAgentImagePart({ type: 'text', text: 'image.png' } as never)).toBe(false)
    expect(isAgentImagePart(null)).toBe(false)
    expect(isAgentImagePart(undefined)).toBe(false)
  })
})

describe('countAgentImageFileParts', () => {
  it('counts zero images for text-only input', () => {
    expect(countAgentImageFileParts([{ type: 'text', text: 'hello' }])).toBe(0)
    expect(countAgentImageFileParts([])).toBe(0)
    expect(countAgentImageFileParts(undefined)).toBe(0)
  })

  it('counts a single image', () => {
    expect(
      countAgentImageFileParts([
        { type: 'text', text: 'look' },
        { type: 'file', mediaType: 'image/jpeg', filename: 'a.jpg' }
      ])
    ).toBe(1)
  })

  it('counts multiple images in order among mixed parts', () => {
    const parts = [
      { type: 'text', text: 'compare' },
      { type: 'file', mediaType: 'image/png', filename: 'first.png' },
      { type: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'second.jpg' },
      { type: 'file', mediaType: 'image/gif', filename: 'third.gif' }
    ]
    expect(countAgentImageFileParts(parts)).toBe(3)
  })
})

describe('countAgentImageAttachments', () => {
  it('counts composer image attachments', () => {
    expect(
      countAgentImageAttachments([
        { type: 'image', ext: '.png', name: 'a' },
        { type: 'document', ext: '.pdf', name: 'b' },
        { type: 'image', ext: '.jpg', name: 'c' }
      ])
    ).toBe(2)
  })
})

describe('countRoutedAgentImageFileParts (#20030 replay)', () => {
  const managedImage = (filename: string, sourceId: string) =>
    withCherryMeta(
      { type: 'file', url: `file:///tmp/${filename}`, mediaType: 'image/png', filename } as never,
      { fileEntryId: `entry-${sourceId}`, fileTokenSourceId: sourceId } as never
    )
  const tokenText = (sourceId: string) =>
    withCherryMeta(
      { type: 'text', text: 'see' } as never,
      {
        composer: {
          version: 1,
          tokens: [{ id: `file:${sourceId}`, kind: 'file', label: sourceId, index: 0, textOffset: 0 }]
        }
      } as never
    )

  it('ignores orphaned managed history without live tokens', () => {
    const parts = [
      { type: 'text', text: 'Previous conversation history' },
      managedImage('a.png', 'source-a'),
      managedImage('b.png', 'source-b'),
      { type: 'text', text: 'new text-only follow-up' }
    ]
    expect(countAgentImageFileParts(parts)).toBe(2)
    expect(countRoutedAgentImageFileParts(parts)).toBe(0)
  })

  it('counts routed images when tokens are present', () => {
    const parts = [tokenText('source-a'), managedImage('a.png', 'source-a'), managedImage('b.png', 'source-b')]
    expect(countRoutedAgentImageFileParts(parts)).toBe(1)
  })

  it('counts external images without cherry meta as routed', () => {
    const parts = [
      { type: 'file', url: 'file:///tmp/a.png', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', url: 'file:///tmp/b.png', mediaType: 'image/png', filename: 'b.png' }
    ]
    expect(countRoutedAgentImageFileParts(parts)).toBe(2)
  })

  it('assertRoutedAgentImageLimit permits orphaned history but rejects routed over-limit', () => {
    const single = visionModel({ maxAgentImages: 1 })
    const orphaned = [
      { type: 'text', text: 'history' },
      managedImage('a.png', 'source-a'),
      managedImage('b.png', 'source-b'),
      { type: 'text', text: 'continuation' }
    ]
    expect(() => assertRoutedAgentImageLimit(orphaned, single, { runtime: 'claude-code' })).not.toThrow()
    const routed = [
      { type: 'file', url: 'file:///tmp/a.png', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', url: 'file:///tmp/b.png', mediaType: 'image/png', filename: 'b.png' }
    ]
    expect(() => assertRoutedAgentImageLimit(routed, single, { runtime: 'claude-code' })).toThrow(AgentImageLimitError)
  })
})

describe('resolveMaxAgentImages', () => {
  it('returns undefined for non-vision models (existing fallbacks apply)', () => {
    expect(resolveMaxAgentImages(visionModel({ capabilities: [] }))).toBeUndefined()
    expect(resolveMaxAgentImages(undefined)).toBeUndefined()
  })

  it('returns undefined for vision models without a declared limit', () => {
    expect(resolveMaxAgentImages(visionModel())).toBeUndefined()
  })

  it('honours an explicit per-model declaration', () => {
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: 1 }))).toBe(1)
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: 0 }))).toBe(0)
  })

  it('ignores invalid declarations', () => {
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: -1 }))).toBeUndefined()
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: 'many' } as unknown as Partial<Model>))).toBeUndefined()
  })

  it('exposes the limit through the production Model contract', () => {
    const parsed = ModelSchema.safeParse(visionModel({ id: 'test::single-image', name: 'Single', maxAgentImages: 1 }))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.maxAgentImages).toBe(1)
    expect(resolveMaxAgentImages(parsed.data)).toBe(1)
  })
})

describe('assertAgentImageLimit', () => {
  const singleImageModel = visionModel({ maxAgentImages: 1 })

  it('passes one image against a single-image limit', () => {
    expect(() =>
      assertAgentImageLimit([{ type: 'file', mediaType: 'image/png', filename: 'a.png' }], singleImageModel)
    ).not.toThrow()
  })

  it('passes multiple images when the model is unlimited', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    expect(() => assertAgentImageLimit(parts, visionModel())).not.toThrow()
  })

  it('throws with the actual limit for over-limit input', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    let error: unknown
    try {
      assertAgentImageLimit(parts, singleImageModel, { runtime: 'claude-code' })
    } catch (thrown) {
      error = thrown
    }
    expect(error).toBeInstanceOf(AgentImageLimitError)
    const limitError = error as AgentImageLimitError
    expect(limitError.limit).toBe(1)
    expect(limitError.count).toBe(2)
    expect(limitError.runtime).toBe('claude-code')
    expect(limitError.i18nKey).toBe('agent_image_limit_exceeded')
    expect(limitError.sent).toBe(false)
  })

  it('marks result-boundary failures as sent with sent-aware wording', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    let error: unknown
    try {
      const normalized = normalizeAgentImageLimitFailure(
        new Error('At most 1 image(s) may be provided in one prompt'),
        2,
        { runtime: 'claude-code', sent: true }
      )
      if (normalized) throw normalized
    } catch (thrown) {
      error = thrown
    }
    expect(error).toBeInstanceOf(AgentImageLimitError)
    const limitError = error as AgentImageLimitError
    expect(limitError.sent).toBe(true)
    expect(limitError.i18nKey).toBe('agent_image_limit_exceeded_after_send')
    expect(limitError.message).toMatch(/already sent|sent .*2 image/i)
    void parts
  })

  it('honours an explicit override limit', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    expect(() => assertAgentImageLimit(parts, undefined, { maxImages: 2 })).not.toThrow()
    expect(() => assertAgentImageLimit(parts, undefined, { maxImages: 1 })).toThrow(AgentImageLimitError)
  })
})

describe('parseUpstreamImageLimit', () => {
  it('parses the reported single-image rejection', () => {
    expect(parseUpstreamImageLimit('At most 1 image(s) may be provided in one prompt')).toBe(1)
  })

  it('parses other upstream limits', () => {
    expect(parseUpstreamImageLimit('at most 4 images in one prompt')).toBe(4)
    expect(parseUpstreamImageLimit('At most 10 image(s) may be provided in one prompt.')).toBe(10)
  })

  it('returns undefined for unrelated failures', () => {
    expect(parseUpstreamImageLimit('Request failed with status 400')).toBeUndefined()
    expect(parseUpstreamImageLimit(undefined)).toBeUndefined()
    expect(parseUpstreamImageLimit('')).toBeUndefined()
  })
})

describe('normalizeAgentImageLimitFailure', () => {
  it('converts an upstream rejection into the limit error shape', () => {
    const error = normalizeAgentImageLimitFailure(new Error('At most 1 image(s) may be provided in one prompt'), 2, {
      runtime: 'pi'
    })
    expect(error).toBeInstanceOf(AgentImageLimitError)
    expect(error?.limit).toBe(1)
    expect(error?.count).toBe(2)
    expect(error?.sent).toBe(false)
    expect(error?.i18nKey).toBe('agent_image_limit_exceeded')
  })

  it('normalizes result-boundary failures with sent-aware wording', () => {
    const error = normalizeAgentImageLimitFailure(new Error('At most 1 image(s) may be provided in one prompt'), 2, {
      runtime: 'claude-code',
      sent: true
    })
    expect(error).toBeInstanceOf(AgentImageLimitError)
    expect(error?.limit).toBe(1)
    expect(error?.count).toBe(2)
    expect(error?.sent).toBe(true)
    expect(error?.i18nKey).toBe('agent_image_limit_exceeded_after_send')
  })

  it('returns undefined when the count fits the parsed limit', () => {
    expect(normalizeAgentImageLimitFailure(new Error('At most 2 image(s) may be provided'), 2)).toBeUndefined()
  })

  it('returns undefined for unrelated errors', () => {
    expect(normalizeAgentImageLimitFailure(new Error('boom'), 3)).toBeUndefined()
  })
})

describe('runtime-specific replay gates (#20030 follow-up)', () => {
  const single = visionModel({ maxAgentImages: 1 })
  const workspacePng = (filename: string, sourceId: string) =>
    withCherryMeta(
      { type: 'file', url: `file:///workspace/${filename}`, mediaType: 'image/png', filename } as never,
      { fileTokenSourceId: sourceId } as never
    )
  const managedImage = (filename: string, sourceId: string) =>
    withCherryMeta(
      { type: 'file', url: `file:///tmp/${filename}`, mediaType: 'image/png', filename } as never,
      { fileEntryId: `entry-${sourceId}`, fileTokenSourceId: sourceId } as never
    )

  it('counts replayed workspace PNGs without live tokens as routed', () => {
    const parts = [
      { type: 'text', text: 'Previous conversation history (reference only)' },
      workspacePng('a.png', 'source-a'),
      workspacePng('b.png', 'source-b'),
      { type: 'text', text: 'continuation' }
    ]
    expect(countAgentImageFileParts(parts)).toBe(2)
    expect(countRoutedAgentImageFileParts(parts)).toBe(2)
    expect(() => assertRoutedAgentImageLimit(parts, single, { runtime: 'pi' })).toThrow(AgentImageLimitError)
  })

  it('excludes AVIF from the Claude native count (path fallback)', () => {
    const parts = [
      withCherryMeta(
        { type: 'file', url: 'file:///workspace/a.avif', mediaType: 'image/avif', filename: 'a.avif' } as never,
        { fileTokenSourceId: 'source-a' } as never
      ),
      withCherryMeta(
        { type: 'file', url: 'file:///workspace/b.avif', mediaType: 'image/avif', filename: 'b.avif' } as never,
        { fileTokenSourceId: 'source-b' } as never
      )
    ]
    expect(canBeClaudeNativeImagePart(parts[0])).toBe(false)
    expect(countClaudeNativeImageParts(parts)).toBe(0)
    expect(() => assertClaudeAgentImageLimit(parts, single, { runtime: 'claude-code' })).not.toThrow()
  })

  it('counts workspace PNGs but not orphaned managed images for Claude', () => {
    const parts = [workspacePng('a.png', 'source-a'), workspacePng('b.png', 'source-b')]
    expect(countClaudeNativeImageParts(parts)).toBe(2)
    expect(() => assertClaudeAgentImageLimit(parts, single)).toThrow(AgentImageLimitError)
    const orphaned = [
      { type: 'text', text: 'history' },
      managedImage('a.png', 'source-a'),
      managedImage('b.png', 'source-b')
    ]
    expect(countClaudeNativeImageParts(orphaned)).toBe(0)
    expect(() => assertClaudeAgentImageLimit(orphaned, single)).not.toThrow()
  })

  it('branches Pi to raw and Claude to native counts', () => {
    const orphanedManaged = [
      { type: 'text', text: 'history' },
      managedImage('a.png', 'source-a'),
      managedImage('b.png', 'source-b')
    ]
    // Pi forwards every file:// path, so orphaned managed history still gates.
    expect(() => assertRuntimeAgentImageLimit(orphanedManaged, single, 'pi', { routed: true })).toThrow(
      AgentImageLimitError
    )
    // Claude drops orphaned managed history in routing, so the same replay passes.
    expect(() => assertRuntimeAgentImageLimit(orphanedManaged, single, 'claude-code', { routed: true })).not.toThrow()
    const workspaceReplay = [
      { type: 'text', text: 'Previous conversation history' },
      workspacePng('a.png', 'source-a'),
      workspacePng('b.png', 'source-b')
    ]
    expect(() => assertRuntimeAgentImageLimit(workspaceReplay, single, 'pi', { routed: true })).toThrow(
      AgentImageLimitError
    )
    expect(() => assertRuntimeAgentImageLimit(workspaceReplay, single, 'claude-code', { routed: true })).toThrow(
      AgentImageLimitError
    )
  })

  it('detects manual /compact instructions for Pi replay bypass (inv_dae5bb8beabb913b)', () => {
    // Both Pi drivers short-circuit on `^/compact` with trimmed text and
    // return without submitting replay — callers skip replay validation.
    expect(isManualCompactParts([{ type: 'text', text: '/compact' }])).toBe(true)
    expect(isManualCompactParts([{ type: 'text', text: '  /compact keep facts  ' }])).toBe(true)
    expect(isManualCompactParts([{ type: 'text', text: '/compact\nnext' }])).toBe(true)
    expect(isManualCompactParts([{ type: 'text', text: 'please /compact' }])).toBe(false)
    expect(isManualCompactParts([{ type: 'text', text: 'hello' }])).toBe(false)
    expect(isManualCompactParts([])).toBe(false)
    expect(isManualCompactParts(undefined)).toBe(false)
  })

  it('matches the Pi driver joined-prompt predicate, including delivery (inv_a799a7c78eb893f7)', () => {
    // Drivers join all text parts with `\n` via `buildAgentUserContent` and test
    // `^/compact` on the trimmed result: a second text part of `/compact` after
    // other text submits an ordinary turn and must still gate.
    expect(
      isManualCompactParts([
        { type: 'text', text: 'Compare these' },
        { type: 'text', text: '/compact' }
      ])
    ).toBe(false)
    // Delivery wrappers prefix the prompt with a security notice, so drivers
    // never treat delivery messages as compact — the gate must not skip.
    expect(isManualCompactParts([{ type: 'text', text: '/compact' }], { hasDelivery: true })).toBe(false)
    expect(
      isManualCompactParts(
        [
          { type: 'text', text: 'Compare these' },
          { type: 'text', text: '/compact' }
        ],
        { hasDelivery: true }
      )
    ).toBe(false)
    // Steers never match (drivers check `!systemReminder`).
    expect(isManualCompactParts([{ type: 'text', text: '/compact' }], { systemReminder: true })).toBe(false)
    // Genuine commands still reach compaction.
    expect(isManualCompactParts([{ type: 'text', text: '/compact keep facts' }])).toBe(true)
    expect(isManualCompactParts([{ type: 'text', text: '  /compact  ' }])).toBe(true)
  })

  it('excludes TIFF/AVIF path-fallback from the Claude native count without MIME (inv_129fa9c831baabe0)', () => {
    // Renderer attachments carry no MIME (only ext/name); the driver forwards
    // TIFF by path, so PNG+TIFF must fit a one-image native cap.
    expect(canBeClaudeNativeImagePart({ type: 'image', ext: '.png', name: 'a' })).toBe(true)
    expect(canBeClaudeNativeImagePart({ type: 'file', filename: 'a.png' })).toBe(true)
    expect(canBeClaudeNativeImagePart({ type: 'image', ext: '.tiff', name: 'b' })).toBe(false)
    expect(canBeClaudeNativeImagePart({ type: 'file', filename: 'b.tiff' })).toBe(false)
    expect(canBeClaudeNativeImagePart({ type: 'file', filename: 'b.avif' })).toBe(false)
    expect(canBeClaudeNativeImagePart({ type: 'file', filename: 'b.bmp' })).toBe(false)
    // Unknown extensions (e.g. `.jpe`, which materializes to `image/jpeg`)
    // defer to materialization and count.
    expect(canBeClaudeNativeImagePart({ type: 'file', filename: 'c.jpe' })).toBe(true)
    const attachments = [
      { type: 'image', ext: '.png', name: 'a' },
      { type: 'image', ext: '.tiff', name: 'b' }
    ]
    expect(countAgentImageAttachments(attachments)).toBe(2)
    expect(countClaudeNativeImageAttachments(attachments)).toBe(1)
    const fileParts = [
      { type: 'file', filename: 'a.png' },
      { type: 'file', filename: 'b.tiff' }
    ]
    expect(countAgentImageFileParts(fileParts)).toBe(2)
    expect(countClaudeNativeFileParts(fileParts)).toBe(1)
  })

  it('normalizes legacy image MIME aliases consistently for admission and routing (inv_975d0894b156ac2a)', () => {
    // A channel may label a valid managed PNG as `image/x-png` while
    // managed-file materialization reports on-disk `image/png` for both.
    // Admission must count both as native so it rejects before row creation,
    // matching the driver's post-materialization guard.
    expect(canBeClaudeNativeImagePart({ type: 'file', mediaType: 'image/png', filename: 'a.png' })).toBe(true)
    expect(canBeClaudeNativeImagePart({ type: 'file', mediaType: 'image/x-png', filename: 'b.png' })).toBe(true)
    expect(canBeClaudeNativeImagePart({ type: 'file', mediaType: 'image/pjpeg', filename: 'c.jpg' })).toBe(true)
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/x-png', filename: 'b.png' }
    ]
    expect(countClaudeNativeImageParts(parts)).toBe(2)
    expect(countClaudeNativeFileParts(parts)).toBe(2)
    expect(() => assertClaudeAgentImageLimit(parts, single)).toThrow(AgentImageLimitError)
  })
})

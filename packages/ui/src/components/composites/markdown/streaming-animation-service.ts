import type { Root } from 'hast'
import { type AnimateOptions, createAnimatePlugin } from 'streamdown'
import type { Plugin } from 'unified'

export interface AnimationLimits {
  maxDocuments: number
  maxBlocks: number
}

export interface AnimationDocumentSnapshot {
  source: string
  optionsKey: string
  blocks: ReadonlyMap<number, number>
}

export class StreamingAnimationService {
  private documents = new Map<string, AnimationDocumentSnapshot>()
  private generations = new Map<string, number>()
  private nextGeneration = 0
  private blockCount = 0

  constructor(private limits: AnimationLimits = { maxDocuments: 256, maxBlocks: 4096 }) {}

  read(id: string): AnimationDocumentSnapshot | undefined {
    const snapshot = this.documents.get(id)
    if (snapshot) {
      this.documents.delete(id)
      this.documents.set(id, snapshot)
    }
    return snapshot
  }

  write(id: string, snapshot: AnimationDocumentSnapshot): void {
    const generation = this.generations.get(id) ?? ++this.nextGeneration
    this.delete(id)
    if (snapshot.blocks.size > this.limits.maxBlocks) return
    this.documents.set(id, { ...snapshot, blocks: new Map(snapshot.blocks) })
    this.generations.set(id, generation)
    this.blockCount += snapshot.blocks.size
    while (this.documents.size > this.limits.maxDocuments || this.blockCount > this.limits.maxBlocks) {
      this.delete(this.documents.keys().next().value!)
    }
  }

  delete(id: string): void {
    this.blockCount -= this.documents.get(id)?.blocks.size ?? 0
    this.documents.delete(id)
    this.generations.delete(id)
  }

  deleteWhere(matches: (id: string) => boolean): void {
    for (const id of this.documents.keys()) if (matches(id)) this.delete(id)
  }

  clear(): void {
    this.documents.clear()
    this.generations.clear()
    this.blockCount = 0
  }

  generation(id: string): number | undefined {
    return this.generations.get(id)
  }
}

export const streamingAnimationService = new StreamingAnimationService()

export function forgetStreamingMarkdownAnimations(matches: (id: string) => boolean): void {
  streamingAnimationService.deleteWhere(matches)
}

type BlockAnimationPlugin = ReturnType<typeof createAnimatePlugin>
interface BlockAnimation {
  content: string
  boundary: number
  plugin: BlockAnimationPlugin
  count?: number
}

export class MarkdownAnimationSession {
  readonly generation: number | undefined
  private initialBlocks?: readonly string[]
  private blocks = new Map<number, BlockAnimation>()
  private committed = new Map<number, number>()
  private restoredBlocks = new Set<number>()
  private recovering: boolean

  constructor(
    readonly id: string,
    private source: string,
    readonly optionsKey: string,
    private options: AnimateOptions
  ) {
    const previous = streamingAnimationService.read(id)
    const compatible = previous?.optionsKey === optionsKey && source.startsWith(previous.source)
    this.recovering = Boolean(compatible && previous.blocks.size)
    if (!compatible) streamingAnimationService.delete(id)
    if (!compatible || !previous) streamingAnimationService.write(id, { source, optionsKey, blocks: new Map() })
    this.generation = streamingAnimationService.generation(id)
  }

  continues(source: string): boolean {
    return source.startsWith(this.source)
  }

  updateSource(source: string): void {
    this.source = source
  }

  captureInitialBlocks(blocks: readonly string[]): void {
    this.initialBlocks ??= blocks.slice()
  }

  getBlock(index: number, content: string): BlockAnimationPlugin {
    const current = this.blocks.get(index)
    if (current?.content === content) return current.plugin
    const boundary =
      this.recovering && index < (this.initialBlocks?.length ?? 0) && !this.restoredBlocks.has(index)
        ? Number.POSITIVE_INFINITY
        : (this.committed.get(index) ?? 0)
    const real = createAnimatePlugin(this.options)
    const block: BlockAnimation = {
      content,
      boundary,
      plugin: {
        name: 'animate',
        type: 'animate',
        getLastRenderCharCount: () => block.boundary,
        setPrevContentLength: (count) => real.setPrevContentLength(count),
        rehypePlugin: function () {
          const transform = (real.rehypePlugin as Plugin<[], Root>).call(this)
          return (tree, file) => {
            real.setPrevContentLength(block.boundary)
            const result = transform?.(tree, file, () => {})
            block.count = real.getLastRenderCharCount()
            return result
          }
        } satisfies Plugin<[], Root>
      }
    }
    // Streamdown keys its processor cache by plugin names; retain the real plugin's unique identity.
    Object.defineProperty(block.plugin.rehypePlugin, 'name', { value: (real.rehypePlugin as Plugin<[], Root>).name })
    this.blocks.set(index, block)
    return block.plugin
  }

  commit(index: number, plugin: BlockAnimationPlugin): void {
    const block = this.blocks.get(index)
    if (block?.plugin !== plugin || block.count === undefined) return
    this.committed.set(index, block.count)
    this.restoredBlocks.add(index)
    block.boundary = block.count
    if (this.generation !== streamingAnimationService.generation(this.id)) return
    streamingAnimationService.write(this.id, {
      source: this.source,
      optionsKey: this.optionsKey,
      blocks: this.committed
    })
  }
}

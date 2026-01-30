import type { Span } from '@opentelemetry/api'

export interface StartSpanParams {
  topicId: string
  name?: string
  inputs?: any | any[]
  tag?: string
  parentSpanId?: string
  modelName?: string
  modelRoot?: boolean
  assistantMsgId?: string
}

export interface EndSpanParams {
  topicId: string
  modelName?: string
  outputs?: any | any[]
  error?: Error
  span?: Span
  modelEnded?: boolean
  assistantMsgId?: string
}

export class ModelSpanEntity {
  private modelName?: string
  private spans: Span[] = []
  private root?: Span
  private assistantMsgId?: string

  constructor(modelName?: string, assistantMsgId?: string) {
    this.assistantMsgId = assistantMsgId
    this.modelName = modelName
  }

  getCurrentSpan(modelName?: string, assistantMsgId?: string): Span | undefined {
    if (!this.isCurrent(modelName, assistantMsgId)) {
      return undefined
    }
    return this.spans.length > 0 ? this.spans[this.spans.length - 1] : undefined
  }

  getRoot(): Span | undefined {
    return this.root
  }

  addSpan(span: Span, isRoot = false) {
    if (isRoot) {
      this.root = span
    }
    this.spans.push(span)
  }

  removeSpan(span: Span) {
    const index = this.spans.indexOf(span)
    if (index !== -1) {
      this.spans.splice(index, 1)
      return true
    }
    return false
  }

  finishSpan() {
    this.spans.forEach((span) => {
      span.setAttribute('outputs', 'you paused')
      span.end()
    })
    this.spans = []
  }

  getModelName() {
    return this.modelName
  }

  getRootSpan() {
    return this.spans && this.spans.length > 0 ? this.spans[0] : undefined
  }

  getSpanById(spanId?: string) {
    return spanId ? this.spans.find((span) => span.spanContext().spanId === spanId) : undefined
  }

  addModelError(error: Error) {
    this.spans.forEach((span) => {
      span.recordException(error, Date.now())
    })
  }

  isCurrent(modelName?: string, assistantMsgId?: string): boolean {
    return this.modelName === modelName && this.assistantMsgId === assistantMsgId
  }
}

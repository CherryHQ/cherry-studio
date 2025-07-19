import { Context, ContextManager, ROOT_CONTEXT } from '@opentelemetry/api'

export class TopicContextManager implements ContextManager {
  private topicContextStack: Map<string, Context[]>
  private _topicContexts: Map<string, Context>

  constructor() {
    // topicId -> context
    this.topicContextStack = new Map()
    this._topicContexts = new Map()
  }

  // 绑定一个context到topicId
  startContextForTopic(topicId, context: Context) {
    const currentContext = this.getCurrentContext(topicId)
    this._topicContexts.set(topicId, context)
    if (!this.topicContextStack.has(topicId) && !this.topicContextStack.get(topicId)) {
      this.topicContextStack.set(topicId, [currentContext])
    } else {
      this.topicContextStack.get(topicId)?.push(currentContext)
    }
  }

  // 获取topicId对应的context
  getContextForTopic(topicId) {
    return this.getCurrentContext(topicId)
  }

  endContextForTopic(topicId) {
    const context = this.getHistoryContext(topicId)
    this._topicContexts.set(topicId, context)
  }

  cleanContextForTopic(topicId) {
    this.topicContextStack.delete(topicId)
    this._topicContexts.delete(topicId)
  }

  private getHistoryContext(topicId): Context {
    const hasContext = this.topicContextStack.has(topicId) && this.topicContextStack.get(topicId)
    const context = hasContext && hasContext.length > 0 && hasContext.pop()
    return context ? context : ROOT_CONTEXT
  }

  private getCurrentContext(topicId): Context {
    const hasContext = this._topicContexts.has(topicId) && this._topicContexts.get(topicId)
    return hasContext || ROOT_CONTEXT
  }

  // OpenTelemetry接口实现
  active() {
    // 不支持全局active，必须显式传递
    return ROOT_CONTEXT
  }

  with(_, fn, thisArg, ...args) {
    // 直接调用fn，不做全局active切换
    return fn.apply(thisArg, args)
  }

  bind(target, context) {
    // 显式绑定
    target.__ot_context = context
    return target
  }

  enable() {
    return this
  }

  disable() {
    this._topicContexts.clear()
    return this
  }
}

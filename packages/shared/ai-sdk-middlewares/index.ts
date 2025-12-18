/**
 * Shared AI SDK Middlewares
 *
 * Environment-agnostic middlewares that can be used in both
 * renderer process and main process (API server).
 */

export {
  buildSharedMiddlewares,
  getReasoningTagName,
  isGemini3ModelId,
  openrouterReasoningMiddleware,
  type SharedMiddlewareConfig,
  skipGeminiThoughtSignatureMiddleware
} from './middlewares'

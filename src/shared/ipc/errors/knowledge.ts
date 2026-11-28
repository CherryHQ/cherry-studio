/** Knowledge-domain IpcApi error codes. Import directly from this module on both sides. */
export const knowledgeErrorCodes = {
  /** A new URL source is malformed or does not use HTTP(S). */
  INVALID_SOURCE_URL: 'KNOWLEDGE_INVALID_SOURCE_URL',
  /** The requested knowledge-managed file or captured URL snapshot cannot provide a preview path. */
  SOURCE_PATH_UNAVAILABLE: 'KNOWLEDGE_SOURCE_PATH_UNAVAILABLE',
  /**
   * An interactive import does not fit the processing capacity (`KNOWLEDGE_ACTIVE_JOB_LIMIT`).
   * Carries `{ capacity: { requested, active, remaining, limit, kind } }` in `data`
   * so the renderer can render the rejection through i18next instead of showing
   * the English fallback message.
   */
  CAPACITY_EXCEEDED: 'KNOWLEDGE_CAPACITY_EXCEEDED'
} as const

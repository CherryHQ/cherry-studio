export const sideChatErrorCodes = {
  BUSY: 'side_chat_busy',
  NOT_FOUND: 'side_chat_not_found',
  QUESTION_NOT_FOUND: 'side_chat_question_not_found',
  INVALID_QUESTION: 'side_chat_invalid_question',
  WINDOW_REQUIRED: 'side_chat_window_required',
  STORAGE_PAUSED: 'side_chat_storage_paused',
  MODEL_UNAVAILABLE: 'side_chat_model_unavailable',
  CONTEXT_LIMIT_UNKNOWN: 'side_chat_context_limit_unknown',
  CONTEXT_TOO_LARGE: 'side_chat_context_too_large'
} as const

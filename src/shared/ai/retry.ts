/**
 * Upper bound on user-configured chat retry fallback models. Main truncates the preference to it and
 * the settings selector refuses further selections, so the two layers cannot disagree. Each fallback
 * is another billable attempt per failed call, so this cap is what keeps the per-call fan-out finite.
 */
export const MAX_RETRY_FALLBACK_MODELS = 5

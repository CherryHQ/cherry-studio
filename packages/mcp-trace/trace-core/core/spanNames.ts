/**
 * Canonical span names shared across the trace pipeline.
 *
 * The per-turn root span is named `ai.turn`. Producers (the chat/agent stream wiring) and
 * consumers (trace storage re-homing + the renderer presenters) MUST reference this constant
 * rather than the string literal so the name can never silently drift between the two PRs.
 */
export const SPAN_NAME_TURN = 'ai.turn'

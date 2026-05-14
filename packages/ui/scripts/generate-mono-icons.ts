/**
 * @deprecated
 *
 * The mono variant was removed when providers/models adopted the light/dark
 * dual-source architecture. This script is kept as a no-op so the existing
 * `pipeline.ts` step doesn't break — the script can be deleted along with
 * the corresponding pipeline step in a follow-up cleanup PR.
 */

console.log('[generate-mono-icons] skipped — mono variant deprecated, light/dark dual source replaces it')
process.exit(0)

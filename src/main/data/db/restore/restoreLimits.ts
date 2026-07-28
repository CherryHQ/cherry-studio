/**
 * Cap on the aggregated sanitation report carried across a relaunch. It keeps
 * the preboot journal bounded; raise only after a real profile proves the new
 * bound remains operationally safe.
 */
export const MAX_JOURNAL_DEGRADATIONS = 200

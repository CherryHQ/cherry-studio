/** Root runs have a bounded request loop and top-level tool admission budget. Child policy stays with its meter. */
export const PI_RUN_LIMIT = 20
export const PI_RUN_LIMIT_MESSAGE =
  'The Pi agent reached its per-run tool or request limit before producing a final answer. Try again or reduce the task scope.'

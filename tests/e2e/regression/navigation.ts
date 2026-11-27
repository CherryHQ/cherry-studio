/**
 * Compatibility entry for specs that live outside this directory (for example
 * `tests/e2e/smoke/*`) and still import the pre-restructure path
 * `../regression/navigation`. Navigation itself is owned by `helpers/navigation.ts`.
 */
export * from './helpers/navigation'

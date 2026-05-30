// Public entry point for the paths module.
//
// Only PathKey / PathMap (types) are re-exported. The actual lookup
// lives in Application.getPath() so that all consumers go through a
// single access point.
//
// The buildPathRegistry() function is intentionally NOT re-exported
// here — it is an internal implementation detail used only by
// Application.ts (via the deeper alias '@main/core/paths/pathRegistry').
// This keeps "bypassing the registry" visually obvious in PR diffs:
// any import from '@main/core/paths/pathRegistry' is a load-bearing
// signal that the file is doing something the encapsulation doesn't
// normally allow.

export type { PathKey, PathMap } from './pathRegistry'

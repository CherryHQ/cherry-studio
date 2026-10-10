import type { ZodType } from 'zod'

/**
 * A single IpcApi request route: a zod `input` schema (renderer→main, untrusted,
 * always parsed) paired with a zod `output` schema. The flat `route → { input,
 * output }` shape is all IpcApi needs — there is no path/method/query/body
 * structure like DataApi's REST schemas.
 */
export interface RouteDef {
  input: ZodType
  output: ZodType
}

/**
 * Declare one request route. This is the identity function at runtime; it exists
 * so a route's input/output schemas are captured in exactly one place and
 * inferred everywhere downstream (handler signature, preload, renderer facade).
 *
 * Validation is always on: the router parses `input` for every request. There is
 * deliberately no "skip validation" knob (YAGNI — add a field later if profiling
 * ever proves a hot route needs it).
 */
export const defineRoute = <D extends RouteDef>(def: D): D => def

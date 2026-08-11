/**
 * Relative filesystem paths: the structural layer (is it anchored to a root?)
 * crossed with the per-platform syntax layer in `pathSpec.ts`.
 *
 * Lives in shared (no `node:*`), which is the point: the knowledge
 * `relativePath` fields each carried a prose copy of this invariant precisely
 * because a schema there "cannot use `node:path` since this module also runs in
 * the renderer". Pure-string parsing removes that objection.
 *
 * ## Two leaves and a union
 *
 * ```text
 *   PosixPathSchema                     WindowsPathSchema        ← syntax (pathSpec.ts)
 *          │ + not anchored (POSIX)            │ + not anchored (Windows)
 *          ▼                                   ▼
 *   PosixRelativeFilePath              WindowsRelativeFilePath
 *          └──────────────┬────────────────────┘
 *                RelativeFilePath (type only)
 * ```
 *
 * Each leaf refines its platform's syntax schema with a structural check, so it
 * carries **two brands**: the spec brand it inherits and its own. The spec brand
 * is what lets a `PosixRelativeFilePath` drop into a consumer that only asks for
 * a `PosixPath` — no re-parse, no re-assertion.
 *
 * Which leaf a consumer wants follows from what it does with the value:
 *
 * - Storing it in a `/`-separated in-app convention → `PosixRelativeFilePath`.
 * - Asking whether it survives a move to Windows → `WindowsRelativeFilePathSchema.safeParse`.
 *   A failure is the answer, not an error: it means that path needs renaming or
 *   conflict handling before it can exist there.
 *
 * `RelativeFilePath` is their union and exists only as a type — see its own doc
 * for why it is not a brand.
 *
 * The structural check is a plain helper rather than a schema of its own,
 * because it is never meaningful alone: "unanchored" says nothing about whether
 * the segments could exist anywhere.
 *
 * ## What none of them prove
 *
 * - **Containment.** `../x` carries these brands. It is a relative path; it just
 *   points outside its base. Whether that is allowed belongs to whoever owns the
 *   base — for the knowledge material root, `assertSafeKnowledgeRelativePath`.
 *   `resolvePosixRelativeSegments` returns `null` on a climb-out so that rule has
 *   something to check without writing a second parser.
 * - **Correspondence.** `docs/notes.md` means nothing without its base. These
 *   brands certify shape, never that a value is relative to any particular base.
 *   Base+relative pairs express that locally, where the base is in scope.
 * - **Normalization.** `parse()` returns the input unchanged — no trim, no
 *   `.`/`..` collapse, no separator folding. Matches `AbsoluteFilePathSchema`,
 *   which is likewise assert-only.
 *
 * ## `.` is a relative path; the empty string is not
 *
 * `.` and `a/..` denote the base itself, which is a legal relative path. "Must
 * point *below* the base" is a business rule, left to the consumers that need it.
 *
 * The empty string is rejected. It is not "the path to the current directory" —
 * it is the absence of a path (`open("")` is `ENOENT`, while `.` resolves fine).
 * Since `.` already denotes the base unambiguously, admitting `''` as a second
 * spelling would only push an "empty means base" special case onto every
 * consumer. `AbsoluteFilePathSchema` draws the same line with its `.min(1)`.
 */

import {
  isPosixPath,
  isWindowsPath,
  type ParsedPath,
  parsePosixPath,
  parseWindowsPath,
  PosixPathSchema,
  WindowsPathSchema
} from '@shared/utils/file/pathSpec'
import type * as z from 'zod'

/**
 * `segments` with `.` and `..` applied, or `null` if the path is anchored to a
 * root or climbs above its base.
 *
 * An empty array means the path denotes the base itself. Underflow returns `null`
 * — unlike `canonicalizeFilePath`, which absorbs it because an absolute root has
 * nowhere above it to escape to. Note this is stricter than the brands, which do
 * not judge containment; see {@link resolvePosixRelativeSegments}.
 */
function resolveRelativeSegments(parsed: ParsedPath): string[] | null {
  if (parsed.isAbsolute || parsed.root !== '') return null

  const stack: string[] = []
  for (const segment of parsed.segments) {
    if (segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return stack
}

/**
 * `value` read as a POSIX path and resolved against its base, or `null` if it is
 * not a POSIX-legal relative path **or climbs out of that base**.
 *
 * The containment check lives here rather than in the brands: `../x` is a
 * perfectly good `PosixRelativeFilePath`, so a consumer that must keep values
 * inside a base needs somewhere to ask, and `null` is that answer. Consumers
 * enforcing "points below the base" or "occupies a reserved prefix" also want the
 * resolved segments, which is why this returns them rather than a boolean.
 */
export function resolvePosixRelativeSegments(value: string): string[] | null {
  if (value.length === 0 || !isPosixPath(value)) return null
  return resolveRelativeSegments(parsePosixPath(value))
}

/** Windows counterpart of {@link resolvePosixRelativeSegments}. */
export function resolveWindowsRelativeSegments(value: string): string[] | null {
  if (value.length === 0 || !isWindowsPath(value)) return null
  return resolveRelativeSegments(parseWindowsPath(value))
}

/**
 * Not anchored to a root under this platform's reading, and non-empty.
 *
 * `..` is not consulted. `../x` is a relative path — it is simply one that points
 * outside its base, and whether that is allowed is the base owner's rule, not a
 * property of the path.
 */
const isRelativeUnder = (parse: (value: string) => ParsedPath) => (value: string) => {
  if (value.length === 0) return false
  const parsed = parse(value)
  return !parsed.isAbsolute && parsed.root === ''
}

const RELATIVE_ERROR = 'must be a relative filesystem path'

/**
 * A relative path in POSIX syntax whose every segment could exist on a POSIX
 * filesystem. `\` and `:` are ordinary filename characters here, so `a\b.txt` is
 * one segment and stays intact.
 *
 * Carries two brands: `PosixPath` from the schema it refines, plus its own. The
 * first means it drops straight into a consumer that only cares about syntax,
 * with no re-parse. Notably it does NOT claim containment; `../x` parses fine.
 *
 * Both brands are phantom — zero runtime cost, dropped on IPC serialization, so
 * receivers re-assert at the trusted boundary. Construction:
 * - Production: `PosixRelativeFilePathSchema.parse(raw)` / `.safeParse(raw)`
 * - Tests / fixtures: `'…' as PosixRelativeFilePath` for readability
 */
export const PosixRelativeFilePathSchema = PosixPathSchema.refine(
  isRelativeUnder(parsePosixPath),
  RELATIVE_ERROR
).brand<'PosixRelativeFilePath'>()

export type PosixRelativeFilePath = z.infer<typeof PosixRelativeFilePathSchema>

/**
 * A relative path in Windows syntax whose every segment could exist on a Windows
 * filesystem: `\` separates, and no segment may use `< > : " | ? *`, a reserved
 * device name, or a trailing `.` / space.
 *
 * `a<b`, `CON.txt` and `name.` are ordinary POSIX filenames with no Windows
 * spelling, so parsing a stored POSIX path through this schema is how a
 * migration finds out what cannot be restored onto Windows as-is.
 *
 * Built the same way as its POSIX counterpart, but on `WindowsPathSchema` and
 * with the structural check reading roots Windows' way — `\foo` is
 * current-drive-absolute and `C:foo` is drive-relative, both anchored, though
 * each is a single unanchored filename when read as POSIX.
 */
export const WindowsRelativeFilePathSchema = WindowsPathSchema.refine(
  isRelativeUnder(parseWindowsPath),
  RELATIVE_ERROR
).brand<'WindowsRelativeFilePath'>()

export type WindowsRelativeFilePath = z.infer<typeof WindowsRelativeFilePathSchema>

/**
 * A relative path under one platform's reading — which one, this type does not
 * say. Use it exactly when that is true: a consumer that cares whether a value is
 * POSIX- or Windows-shaped should name the branch it means and validate with that
 * branch's schema.
 *
 * A union rather than a brand of its own, so it cannot be minted without first
 * picking a reading. A standalone "structurally relative" brand would admit
 * `a\0b` — non-empty, unanchored, and storable on no filesystem — because
 * segment legality only exists per platform.
 *
 * As VALUE SETS the branches nest: every Windows-relative string is also
 * POSIX-relative, since POSIX only refuses the empty string, a leading `/`, and
 * NUL, all three of which Windows refuses too. They stay distinct TYPES because
 * a brand records the READING that was applied, not set membership. `a\b.txt`
 * carrying `WindowsRelativeFilePath` means "two segments, `a` then `b.txt`";
 * the same string carrying `PosixRelativeFilePath` means "one filename".
 * Interchanging them would silently reinterpret the path, which is the entire
 * hazard this module exists to prevent.
 *
 * No schema is exported. `z.union([Posix, Windows])` would build one in a line,
 * but nothing parses at this level yet, and a union's `invalid_union` error
 * buries both branch messages under a bare "Invalid input".
 */
export type RelativeFilePath = PosixRelativeFilePath | WindowsRelativeFilePath

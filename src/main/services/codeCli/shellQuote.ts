/**
 * Shell-quoting helpers for assembling the terminal-launch command.
 *
 * The launch command is built as a POSIX shell string (and, on macOS, wrapped again by AppleScript
 * `do script`), so any fragment interpolated into it — e.g. the working directory — is a
 * command-injection surface unless it is quoted for the shell it lands in.
 */

/**
 * Wrap an arbitrary string as a single POSIX shell token using single quotes, escaping embedded
 * single quotes via the standard `'\''` idiom. Inside the result no shell metacharacter (spaces,
 * `$()`, backticks, `;`, `|`, quotes …) is interpreted, so it is safe to interpolate into a POSIX
 * shell command.
 */
export function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Escape a string for embedding inside a POSIX double-quoted context (`"…"`). Double quotes still
 * expand `$` and backticks, so those must be escaped alongside `\` and `"` — otherwise an already
 * single-quoted fragment nested inside outer double quotes would still allow command substitution.
 */
export function escapeForDoubleQuotes(str: string): string {
  return str
    .replace(/\\/g, '\\\\') // Escape backslashes first so the ones added below survive
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

// Model ids are drawn from a curated provider catalog and only ever use these characters. Anything
// else (spaces, `;`, `$()`, backticks, quotes …) has no legitimate place in a model id and would be
// a shell-injection risk once concatenated into the launch command, so the caller rejects it rather
// than launch. This mirrors how the provider name is already sanitized via `sanitizeProviderName`.
const SAFE_MODEL_ID = /^[A-Za-z0-9._:/@+-]+$/

/** True when a model id is safe to concatenate bare into a POSIX shell / `.bat` launch command. */
export function isShellSafeModelId(model: string): boolean {
  return SAFE_MODEL_ID.test(model)
}

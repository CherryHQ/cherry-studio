import { REDACTED } from '@shared/utils/redaction'

const REPLACEMENT = `$1${REDACTED}:${REDACTED}@`

// Scan only at scheme-token boundaries so long text never backtracks quadratically.
const URL_TOKEN_RE = /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\/\S*/gi
// The authority of a URL that parses ends at the first `/`, `?` or `#`, so its userinfo
// never contains one: the last `@` before them is the credential boundary.
const PARSED_USERINFO_RE = /(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/?#]*@/gi
// Nothing bounds the userinfo of a URL that fails to parse (`http://user:ab/cd@proxy:8080`),
// so everything up to its last `@` counts as credentials; over-redaction is the safe direction.
const UNPARSED_USERINFO_RE = /^([a-z][a-z\d+.-]*:\/\/).*@/i

/** Redact URL-shaped userinfo in free text, including malformed URLs, without changing the remaining text. */
export function redactUrlCredentials(text: string): string {
  return text.replace(URL_TOKEN_RE, (token) => {
    if (!token.includes('@')) return token
    return token.replace(URL.canParse(token) ? PARSED_USERINFO_RE : UNPARSED_USERINFO_RE, REPLACEMENT)
  })
}

# Scan rules

One file per domain, each exporting a `readonly ScanRule[]`. `registry.ts` concatenates them and validates every rule at import time. How a rule is *evaluated* is documented in `../types.ts`; this file is about **what makes a rule worth adding**.

## The scan is a net for common errors, not a catalogue

This module intercepts a batch of frequently-hit errors. Covering every line that could appear in a log is explicitly not the goal.

People read that backwards, so state it plainly: it does **not** license narrow rules — it demands the opposite. A rule matching one vendor's exact sentence costs the same review, fixtures and maintenance as a general one, and pays off on a fraction of the traffic. If you cannot state the rule as a sentence about an *error class* — "a provider rejected our credentials", "the request never reached the server" — it is not a rule yet.

Prefer missing an exotic error over shipping a rule that only its author's log could have matched.

## Signal hierarchy

Anchor on the most stable thing that identifies the class:

| Rank | Signal | Example | Why |
|---|---|---|---|
| 1 | Protocol / runtime constants | `ECONNREFUSED`, `ERR_CERT_*`, `UND_ERR_CONNECT_TIMEOUT` | emitted by Node and Chromium, identical everywhere, never translated |
| 2 | Standardised API error codes | `model_not_found`, `invalid_request_error` | vendor-agnostic by convention, survive message rewording |
| 3 | Status codes **with status context** | `"statusCode":401`, `HTTP 429` | stable, but see the next section |
| 4 | English prose | `insufficient balance`, `no such model` | vendors reword without notice; last resort |

Prose anchors are allowed — several rules need them — but each alternative must be phrasing that *multiple* providers emit, not one product's wording.

## A bare number is not a signal

`\b401\b` was the highest-volume anchor here and also its worst. Collisions observed in real logs:

| Collides with | Real example |
|---|---|
| Token accounting | `"outputTokens":401` |
| Timestamp milliseconds | `2026-08-20T14:30:24.401+08:00` |
| Source line numbers | `AppearanceSettings.tsx:403-417` |

The neighbouring-keyword guard that these rules pair the number with (`api|key|token|auth|…`) is satisfied *by the collision itself* — `outputTokens` contains `token`, and our own `DataApiError` contains `api`. So require status context before the digits: `status(?:Code)?["\s:]{0,4}` or `\bHTTP[ /]?`, and remember that a real status code still does not make the error a provider's.

## An exclude that names a vendor means the anchor is wrong

`network-fetch-timeout` fired on `Jina Reader fetch failed: HTTP 451`. An `exclude: /SecurityCompromiseError/` would have fixed that one log line and nothing else.

The general statement is `fetch failed[^\n]{0,20}HTTP \d{3}`: an HTTP status means the request reached the server, so it is not a timeout — whoever sent it. That also enforces the rule's own `devMessage`, which claims only failures "without a specific cause".

The trap runs the other way too. `provider-rate-limited`'s positive fixture deliberately contains a **web-search** throttle, so excluding a whole subsystem to silence one record would delete real findings.

## Every anchor alternative needs an observed error behind it

`too many requests` — the literal HTTP 429 reason phrase, obviously correct on paper — scored **0 true positives and 2 false positives** across 13k real error lines and 1.8k user bug reports. Both hits were the phrase quoted inside an upstream site's abuse-block prose. It was removed; a status-qualified `429` and `rate.?limit` already carry every real throttle.

Speculative alternatives are not free: they only ever fire on the cases you did not think about. Add the branch when a real log shows the phrasing, and land the fixture line that proves it.

## Validating a change

Regexes are easy to get directionally right and quantitatively wrong. Before changing an anchor:

1. Run old and new over a real corpus **independently**, then diff the hit sets **both ways**. Filtering the old rule's hits only shows what you lost — it cannot show what you newly, wrongly match.
2. Read every gained and every lost record. A tightening should come out a strict subset; a widening should be able to name its new hits.
3. Check a second corpus with a different distribution. Log lines and user-written bug reports fail in different ways — the timestamp-millisecond collision above only showed up in one of them.

Corpora stay out of the repo: they are real user content. Diagnostic bundles users send back are the supply.

## Fixtures are mandatory

`../__tests__/fixtures/<domain>/<rule-id>.{positive,negative}.jsonl` — at least one line each, in the directory matching the rule's `domain`. `../__tests__/rules.fixtures.test.ts` fails on a missing, empty, misfiled or orphaned fixture, and runs each line through the production parse path.

**Synthetic and sanitized only.** Never paste a real user's log line.

Negative fixtures are the regression net. When a false positive turns up in the field, its sanitized line belongs here, so that re-loosening the anchor turns the suite red instead of quietly restoring the bug.

## Mechanical constraints

`registry.ts` throws at import — and therefore in every test — unless:

- the id is kebab-case and prefixed with its domain
- ids are unique across all domains
- the rule has a non-empty `devMessage` and at least one anchor
- no anchor or exclude carries a `g` or `y` flag, whose `lastIndex` persists across `.test()` calls and silently misses matches

The domain set in `../types.ts` is closed. A rule fitting none of the six is a reason to discuss the domain, not to stretch an existing one.

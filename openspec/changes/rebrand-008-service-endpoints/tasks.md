# Tasks — rebrand-008-service-endpoints

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## Scoping — the key decision

The plan estimated ~180 references across 15+ domains. Most of that volume is
**Cherry-operated services the app still consumes** (`open.cherryin.net` 63,
`open.cherryin.ai` 31, `express-ent-admin.cherryin.ai` 20 …). Repointing those
would break working OAuth and provider integrations. Only **user-facing links we
should own** were changed.

## Changed — links we own

Added to the branding module: `REPO_URL`, `WEBSITE_URL`, `DOCS_URL`,
`RELEASES_URL`, `ISSUES_URL`, `SUPPORT_EMAIL`.

| Surface | Was | Now |
|---|---|---|
| About page (8 links) | docs/website/repo/releases/careers/enterprise | Boss repo + site |
| Feedback dialog | `CherryHQ/cherry-studio/issues/new/choose` | `ISSUES_URL/new/choose` |
| Support email ×2 | `support@cherry-ai.com` | `SUPPORT_EMAIL` |
| Feedback mail subject | `'Cherry Studio Feedback'` | `${PRODUCT_NAME} Feedback` |
| App menu website | `cherry-ai.com` | `WEBSITE_URL` |
| MCP OAuth `clientUri` | upstream repo | `REPO_URL` |
| Discord bot User-Agent | upstream repo | `REPO_URL` |
| Docs deep links ×6 | `docs.cherry-ai.com/...` | `DOCS_URL` (per user decision) |

**Infrastructure check before writing anything:** `the-boss.know-me.tools` is a
catch-all SPA — every path, including nonsense ones, returns HTTP 200 with the
marketing page. So `DOCS_URL` points at the repo README, which has real content,
rather than at a URL that would render as marketing copy.

## Deliberately unchanged

- **Updater** (`releases.cherry-ai.com`) — D3: no Boss release feed exists.
- **CherryIN / CherryAI / Cherry Cloud** OAuth and provider endpoints — real
  services this app uses.
- **`ProviderRegistryUpdaterService`** — fetches *upstream's* model catalog;
  repointing would stop model updates.
- **302.ai SSO** `app=cherry-ai.com` — an identifier registered with a third party.
- **`www.cherry-ai.com` in `new URL(...)` calls** — a dummy base for relative-path
  parsing, never navigated to or displayed.

## A regression the tests caught

`builtinMcpServerSeeder.isLegacyMcpAutoInstall()` identifies legacy DB rows by
matching their **historical** reference URL. Rebranding it meant real legacy rows
stopped matching and would never migrate — a silent data-migration failure.
Reverted with a comment; the preset that creates *new* rows does use `DOCS_URL`.
Same class as the backup-format marker in 0075: historical values are detection
input, not branding.

## Evidence

- `pnpm test:main` → 16383 passed, 0 failed
- `pnpm test:renderer` → 12138 passed, 0 failed
- `pnpm lint` → exit 0 (4 typecheck projects, 76011 translations)
- 4 tests repointed at the constants rather than re-pinned to new literals,
  including a security-relevant assertion that local paths never reach the
  mailto URL

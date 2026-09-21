# Tasks — rebrand-006-i18n-strings

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## What changed

828 product-name values across 13 locales x 2 trees: "Cherry Studio" -> "The Boss",
"CherryStudio" -> "TheBoss". Zero residual product references.

**25 third-party service strings deliberately kept**: CherryIN, CherryAI, Cherry Cloud,
Cherry account, provider.cherryai/cherryin. These name real services that still exist;
renaming them would be wrong (CherryIN is an OAuth provider at open.cherryin.ai).

**8 English grammar fixes** where the substitution broke: "Built-in The Boss advisor"
-> "Built-in advisor for The Boss", "the The Boss bundle" -> "the Boss bundle", etc.
Other locales checked: Portuguese "do/o The Boss" and German "der The Boss" are correct
foreign-brand-as-noun usage, left alone.

**Built-in agents (option 1)**: display descriptions rebranded; cherry_assistant /
cherry_support keys, seeder, and DB rows untouched. Verified safe first: the SQL in
AgentService.ts:106 uses the description as a search haystack, not an identity key --
rows are identified by builtin_role and reserved IDs, and the seeder writes
description: "" with a UUID.

## Evidence

- pnpm i18n:check -> 76011 translations validated (key parity, interpolation, sort order)
- pnpm i18n:hardcoded:strict -> no hardcoded strings
- All 26 JSON files parse; key counts identical to HEAD (verified programmatically)
- Renderer sentry test repointed at the package name rather than a brand literal

## Outstanding

- chat.default.name is still "Cherry Assistant" and the seeder hardcodes that name
  plus a cherry avatar. Left per option 1; needs a DB migration to change.
- cherry-text-logo.svg (from rebrand-005) is still a Cherry wordmark in MCP settings.

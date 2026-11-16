# Agent Note: Retire the built-in MCP servers that require a third-party credential

Status: proposed

English | [中文](2026-11-16-retire-credentialed-builtin-mcp-servers.zh.md)

## Problem

The built-in MCP catalog offers six servers that only work with a vendor account:

| Server | Vendor | Credential it needs | Transport it used |
|---|---|---|---|
| `@cherry/didi-mcp` | DiDi | `DIDI_API_KEY` | in-process |
| `@cherry/dify-knowledge` | Dify | `DIFY_KEY` plus a host argument | in-process |
| `@cherry/brave-search` | Brave Search | `BRAVE_API_KEY` | in-process |
| `@cherry/flomo` | flomo | account authorization | remote HTTP |
| `@cherry/qveris` | QVeris | OAuth sign-in, or `QVERIS_API_KEY` | remote HTTP |
| `@cherry/nowledge-mem` | Nowledge Mem | the local Nowledge app running | remote HTTP |

Every one of them asks the user for a credential Cherry cannot ship. A marketplace entry that only works after the user signs up for a separate account is a link to a third party's onboarding, not a capability the product provides. The eight built-ins that remain — memory, sequential thinking, fetch, filesystem, python, the auto-install helper, browser and the hub aggregator — need no vendor account.

The six also cost real code and a set of special cases that only exist because of them:

- `src/main/ai/mcp/servers/didiMcp.ts`, `difyKnowledge.ts` and `braveSearch.ts` are three in-process MCP servers, each wrapping one vendor's REST API behind the MCP protocol.
- `resolveBuiltinExternalMcpServer` in `src/main/ai/mcp/servers/factory.ts` rewrote the endpoint and headers of the three remote servers at connect time, and turned `QVERIS_API_KEY` into a Bearer header.
- `prefersOAuth` in `src/main/ai/mcp/connections/ExternalMcpConnection.ts` special-cased the built-in QVeris server, because its static key was only a fallback credential and the OAuth provider had to stay attached.
- `showsEnvEditor` in `src/renderer/pages/settings/McpSettings/McpServerFields.tsx` grew a `builtinRequiresEnv` parameter so a remote server could show an env field, which only QVeris used.

Retiring them is not only a matter of deleting the presets. An installed row outlives the code that served it:

- A row for one of the three in-process servers has `type: 'inMemory'`. Once `hasInMemoryImplementation` stops answering for its name, `mcpTransportKind` reports the row as `invalid` and the runtime can no longer start it.
- A row for one of the three remote servers keeps a working endpoint, but it loses the runtime rewriting that supplied it. QVeris additionally loses the translation of its API key into a header, so the credential the user typed stops authenticating anything.
- `BuiltinMcpServerSeeder` reconciles installed rows against the preset catalog by iterating `PRESET_MCP_SERVERS`. Once the six names leave that catalog, the seeder no longer covers their rows: a row still on the retired in-process transport would never be repointed at a working endpoint.

## Proposal

Remove the six built-ins and everything that existed only to serve them. The eight vendor-neutral built-ins stay.

The presets, the three in-process implementations and their test go. `resolveBuiltinExternalMcpServer` goes with them, and `createBuiltinMcpEndpoint` keeps only the names that still have an implementation. `prefersOAuth` loses the QVeris special case and keeps the rule that already covered every other server: a server without a static credential signs in through OAuth, a server that carries one authenticates with it. `showsEnvEditor` loses `builtinRequiresEnv`, because no remaining remote built-in reads an env field.

Retiring a built-in has to leave installed rows consistent, so a new `RetiredBuiltinMcpServerSeeder` handles them. It runs after `BuiltinMcpServerSeeder`, and it recognises a retired row by name plus `installSource = 'builtin'`, so a server the user added themselves under a colliding name is left alone.

The six rows split by what they can still do:

- **Hosted rows** (flomo, QVeris, Nowledge Mem) keep a remote endpoint the user can still reach. The row survives as a user-owned server: `installSource` becomes `manual`, and the endpoint and credential stay. A row still on the retired in-process transport adopts the hosted endpoint, because the preset that used to carry it has left the catalog and `BuiltinMcpServerSeeder` no longer covers it. QVeris moves `QVERIS_API_KEY` from env into the `Authorization` header that carries it, since the translation that did that lived in the code this removes.
- **In-process rows** (DiDi, Dify Knowledge, Brave Search) have no transport left at all. The row and its `agent_mcp_server` and `assistant_mcp_server` bindings are removed, so no agent or assistant keeps pointing at a server that cannot start.

The i18n descriptions of the six servers go with them, in all seventeen locales.

Out of scope:

- The six vendors' own MCP servers, which users can still add themselves. The marketplace and the add-server dialog are unchanged.
- The eight remaining built-ins, and the `hub` aggregator that includes them.
- The `@cherry/mcp-auto-install` helper, which installs third-party MCP servers on request and is the supported path to the six vendors' servers.

## Alternatives considered

- Keep the six and ask each vendor for a hosted endpoint Cherry can ship without a user credential: no vendor offers that today, and the answer would still leave the user signing up on the vendor's site.
- Keep the six in the catalog but move them out of the marketplace view: the catalog is what the runtime reads, so the special cases in `factory.ts` and `ExternalMcpConnection.ts` would stay and the six would remain the only built-ins that need a credential.
- Delete the rows of all six instead of converting the hosted ones: three working servers would disappear from users' installations, taking their configuration with them. A hosted endpoint the user can still reach does not need to be re-added.
- Keep `resolveBuiltinExternalMcpServer` for the hosted three and only remove the in-process ones: the function exists to rewrite the endpoint of a built-in row, and the hosted rows stop being built-ins. The rewriting would then apply to rows that are no longer built-ins, which is the confusion the retirement removes.
- Keep QVeris's `QVERIS_API_KEY` translation in the runtime rather than moving it into the row: it would keep a vendor-specific branch in the connection layer for a server that is no longer a built-in.
- Retire the hosted rows by leaving `installSource = 'builtin'`: the settings page would still present them as built-ins that cannot be re-installed from the marketplace, and the built-in filter would list servers the catalog no longer contains.

## Acceptance criteria

- AC1 — `BuiltinMcpServerNames` and `PRESET_MCP_SERVERS` contain none of `@cherry/didi-mcp`, `@cherry/dify-knowledge`, `@cherry/brave-search`, `@cherry/flomo`, `@cherry/qveris` or `@cherry/nowledge-mem`, and the marketplace offers only built-ins that need no vendor credential. (verification: unit + review)
- AC2 — `src/main/ai/mcp/servers` holds no implementation for a removed server, and `createBuiltinMcpEndpoint` and `hasInMemoryImplementation` answer only for the servers that remain. (verification: unit)
- AC3 — No code path rewrites a built-in server's endpoint, headers or credential at connect time; a remote server signs in through OAuth when it carries no static credential, and authenticates with its own header when it carries one. (verification: unit)
- AC4 — An installed row for a hosted retired built-in keeps working as a user-owned server: its endpoint, its credential and its agent and assistant bindings survive, and it is no longer presented as a built-in. (verification: unit)
- AC5 — A QVeris row keeps authenticating after the retirement: the configured API key reaches the server as a Bearer header. (verification: unit)
- AC6 — A hosted row that was still on the retired in-process transport is repointed at the hosted endpoint, and a row that already uses an endpoint keeps it. (verification: unit)
- AC7 — An installed row for an in-process retired built-in and its agent and assistant bindings are removed, so nothing references a server that cannot start. (verification: unit)
- AC8 — A server the user owns is never retired by the seeder, even when its name collides with a retired built-in. (verification: unit)
- AC9 — The seventeen locale files carry no description for a removed server, and the i18n unused-key check reports none. (verification: unit)

## Risks

- A user who relied on the built-in DiDi, Dify Knowledge or Brave Search servers loses the row when they update. Their vendor credential stays with the vendor, and the vendor's own MCP server remains addable by hand, but the one-click path is gone. This is the intended outcome of retiring the built-in, and it is why the removal is announced rather than silent.
- The three remote servers keep working only while their vendor endpoints keep working. The rows become ordinary user-owned servers, so a broken vendor endpoint is now the user's to observe rather than a built-in Cherry maintains.
- QVeris's API key moves from an env field to a header field. The settings page shows the header next to the endpoint it authenticates, but a user who looked for the key under env will not find it there. The seeder moves it, so no credential is lost.
- `RetiredBuiltinMcpServerSeeder` recognises retired rows by name, because the presets that carried them have left the catalog. A future built-in that reuses one of the six names would be retired by this seeder too. The names are Cherry-owned, so a reintroduction would carry a new name.
- The seeder runs once, at the first start after the update. A user who installs the update, and restores an old database afterwards, keeps rows that no longer resolve. Restoring an old database already restores its old schema, and the next seeding pass re-runs the seeder for it.

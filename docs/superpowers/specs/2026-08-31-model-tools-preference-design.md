# Model-Native Web Search Preference

## Goal

Make the Web Search settings switch, persisted preference, and routing behavior use the same boolean meaning: `true` prefers model-native search and URL fetching, while `false` prefers the configured services shown above the switch.

The setting title is `优先使用模型内置搜索`. Its tooltip is `模型内置搜索服务不可用时自动切换到上方服务`. Equivalent copy is provided for every supported locale.

## Preference Contract

Replace `chat.web_search.client_tools_preferred` with `chat.web_search.model_tools_preferred`. The new key defaults to `true` and remains owned by Preference because it is a stable, user-configurable value shared by renderer and main processes.

All code-facing names use `modelToolsPreferred`. The settings switch reads and writes the value directly. Web-tool routing interprets `true` as model-native first and falls back to configured services only when the model-native capability is unavailable; `false` selects configured services first and falls back to model-native capabilities when needed.

## Existing-User Migration

Evolve the existing run-on-change Web Search preference Seeder. Its changed hash version makes it run for installations that already applied the earlier version as well as direct upgrades. When the legacy row exists, migrate it using:

```text
model_tools_preferred = !client_tools_preferred
```

Then remove the legacy row. Replacing the earlier Seeder behavior avoids an intermediate rewrite of legacy `true` values during a direct upgrade, while the changed version reruns against users who already received that earlier behavior. This preserves every existing user's effective routing choice while giving new installations the direct default value `true`. The migration is synchronous and atomic because it changes two preference rows as one logical operation.

No SQLite schema migration is needed: the preference table already stores schema-defined key/value rows, and the generated Preference contract is updated through `target-key-definitions.json`.

## User Interface and Content

Preserve the current uncommitted `ToolSourceSettings` layout that places the explanatory copy in an `InfoTooltip` beside the title. Change the translation key namespace from `client_tools_preferred` to `model_tools_preferred` so visible copy and the underlying setting share the same concept. The switch accessible name uses the new title.

All supported locale files receive equivalent title and tooltip translations. The Simplified Chinese values match the requested wording exactly.

## Verification

Use test-driven changes at the lowest sufficient layers:

- Routing tests prove `true` selects model-native tools, `false` selects configured services, and either side falls back when unavailable.
- The Web Search settings test proves the switch exposes the new accessible name and persists its checked value directly.
- Preference seeder tests prove a new installation defaults to `true`, legacy `false` migrates to `true`, legacy `true` migrates to `false`, and reruns do not overwrite later user choices.
- Run the focused shared, main, and renderer tests, followed by `pnpm i18n:check` and the repository's scoped change verification.

## Scope

This change does not alter provider availability detection, add a new persistence subsystem, change the existing tooltip layout, or modify unrelated Web Search settings.

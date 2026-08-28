---
title: Assistant temperature / top-p / max-tokens take effect again
category: changed
severity: notice
introduced_in_pr: '#17322'
date: 2026-08-03
---

## What changed

An assistant's Temperature, Top-P and Max Tokens settings are sent to the model
again. They had been silently dropped: the plugin that carries them never ran on
the chat path, so requests went out with the model's own defaults no matter what
the assistant said.

The same fix restores two other request details on that path: provider-native
web search / URL context (previously never injected for any provider) and the
Anthropic interleaved-thinking and Vertex web-search beta headers.

## Why this matters to the user

Users who had turned Temperature / Top-P / Max Tokens on will see answers change
— that is the settings finally being honoured, not a regression. Anyone who had
compensated for the drop by pushing a value to an extreme should re-check it.
Assistants that leave these toggles off (the default) are unaffected.

## What the user should do

Nothing — automatic. Review any assistant whose sampling values were tuned while
the settings were inert.

## Notes for release manager

Worth one line in the release note; the web-search half is covered by the
provider-native search entries.

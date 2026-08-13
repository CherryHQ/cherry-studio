---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Fix `api_gateway.required` dialog mounting bug where the prompt was attached
to each agent tab individually instead of being window-level. When an agent
session's tab became dormant (or the user navigated away), the gateway prompt
would never appear. Also eliminated duplicate IPC subscriptions across tabs.

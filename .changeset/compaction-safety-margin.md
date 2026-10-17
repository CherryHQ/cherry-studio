---
---

App-only change (no published-package release): harden auto-compaction budgets against overstated context windows.

- In-loop and turn-start compaction now budget from a 10%-margined effective window and honor the configured compression threshold, so compaction triggers earlier instead of after the provider rejects the request; trigger decisions log the declared/effective windows and budgets for diagnosis.
- Claude Code sessions now budget by the endpoint that serves the model: relays that may overstate the window get a conservative margin (the 256K-declared/128K-real case from #18894 now compacts inside the real limit) while Anthropic-official channels keep their full budget. Gateway sessions budget the weakest routed slot, oversized output caps shrink to fit the trigger-point request, and the trigger percentage fits the smallest declared window.

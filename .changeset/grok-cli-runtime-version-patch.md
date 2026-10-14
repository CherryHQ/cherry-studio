---
'CherryStudio': patch
---

fix(grok-cli): read `x-grok-client-version` from `~/.grok/version.json` at startup and fall back to the floor (`1.0.13`) when the file is missing or unreadable. Eliminates recurring HTTP 426 outages caused by hardcoded Grok CLI client versions going stale when xAI bumps the floor. Honors `GROK_CLIENT_VERSION_OVERRIDE` for emergency ops. Supersedes #21277.
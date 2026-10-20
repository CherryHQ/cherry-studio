---
'@cherrystudio/provider-registry': patch
---

Declare that CherryIN's `openai/gpt-5.6-terra` offer does not accept `temperature`, so chat requests omit the parameter instead of failing with HTTP 400 "Unsupported parameter: 'temperature' is not supported with this model."

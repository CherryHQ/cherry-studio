---
'@cherrystudio/ai-sdk-provider': patch
---

Fix CherryIN image-edit requests failing with `invalid character '-' in numeric literal`.

The JSON headers getter hard-coded `Content-Type: application/json`, which leaked into `OpenAICompatibleImageModel`'s `/images/edits` call. That path uses `postFormDataToApi` and relies on `fetch` to auto-set `multipart/form-data; boundary=...`; forcing JSON made the server try to parse the multipart body as JSON and choke on the leading `--boundary`. Removed the explicit `Content-Type` — `postJsonToApi` still defaults it for JSON endpoints.

---
'@cherrystudio/ai-sdk-provider': patch
---

Fix `openai/gpt-image-2` image edits through CherryIN failing on HTTP 200 with `Failed to process successful response` (#19991).

CherryIN fronts several image backends behind the OpenAI image endpoints, so a 200 can carry the pixels under a key the strict SDK schema rejects (`base64_json`, `b64Json`, top-level `images`, …). The CherryIN OpenAI image model now captures the raw 200 body per call and re-parses it leniently when the strict parse fails, accepting the same key variants plus whitespace-wrapped base64. A 200 that still yields no image data throws a non-retryable error carrying the sanitized response shape and a note that the upstream generation may have been billed, so a retry is a new billable generation. Non-200 failures (e.g. 504) pass through untouched.

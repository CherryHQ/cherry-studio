---
---

Application-local change: the direct image-generation path now fails loudly when the provider returns no usable images instead of completing as an empty success. The error states the request completed upstream, may still have been billed, and was not retried automatically.

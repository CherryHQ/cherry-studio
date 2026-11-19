---
'@cherrystudio/remote-transport': patch
'@cherrystudio/file-preview': patch
---

Validate outbound control records before JSON encoding, rejecting non-finite numbers, functions, cycles, and other unsupported JavaScript values. Preserve reserved keys and omission of optional object fields; valid JSON records and binary upload framing remain unchanged.

Keep PDF document failure callbacks and spreadsheet chart warnings working when host readers reject with values that cannot be converted to text. Preserve native Error identity in the PDF callback.

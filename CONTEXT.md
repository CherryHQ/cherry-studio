# Cherry Studio

Desktop AI assistant. This glossary covers the composer clipboard domain; extend
it as other domains' terms are resolved.

## Language

### Composer Clipboard

**Rich copy**:
A copy action that writes plain text, safe HTML, and the private fragment
together.
_Avoid_: rich content copy, full copy

**Private fragment**:
The versioned Cherry-only clipboard payload of ordered text and token segments.
_Avoid_: custom format payload, token JSON

**Restoration context**:
The renderer session's in-memory state that lets pasted content regain composer
token identity. Spans file restoration handles and the last rich copy's
fragment (the session cache). Gone after window reload or app restart.
_Avoid_: clipboard cache, global registry

**Restoration handle**:
An unguessable, expiring key written into a private fragment in place of file
metadata; only resolvable through the restoration context that issued it.
_Avoid_: file token id, file reference

**Session cache**:
The part of the restoration context holding the last rich copy's fragment, so a
paste of that copy restores tokens without reading the system clipboard.
_Avoid_: clipboard mirror, write-back cache

**Marker**:
A human-readable token stand-in that survives in plain text (`/skill/`,
`#knowledge#`) and may be re-resolved on paste; the lowest-fidelity restore
tier.
_Avoid_: tag, placeholder

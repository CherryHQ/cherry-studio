# Cherry Studio Context

Canonical language for user-facing and engineering concepts that span Cherry Studio domains.

## Language

**Migration diagnostic bundle**:
A user-saved archive for diagnosing a v1-to-v2 migration failure. It never contains the database, WAL/SHM files, migration exports, or recovered business records.
_Avoid_: Migration backup, database bundle

**Migration diagnostics journal**:
A crash-safe sidecar that stores bounded, allowlisted migration session and attempt state independently of the database. It is not an application log and never stores raw errors or business data.
_Avoid_: Migration log, restore journal

**Strict migration diagnostic bundle**:
A migration diagnostic bundle containing only versioned, allowlisted structured diagnostics. It excludes application logs and free-form error text.
_Avoid_: Sanitized log bundle, anonymous diagnostic bundle

**Log-assisted migration diagnostic bundle**:
A migration diagnostic bundle that additionally contains parseable logs from the current migration session after package-time best-effort credential and path redaction. It may still contain user-authored text or unknown sensitive information and is not anonymous.
_Avoid_: Raw log bundle, safe log bundle, anonymous log bundle

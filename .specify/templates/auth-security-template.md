# Auth & Security Specification: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Input**: spec.md, research.md, api-spec.md (if exists), backend-spec.md (if exists)

<!--
  GENERATION CONDITION:
  Only generate this file when ANY of these are true:
  - Feature spec references: user accounts, login, signup, authentication, authorization, roles, permissions
  - Technical Context Authentication field is NOT "none" or "N/A"
  - Project Type is: saas, web-app, mobile-app, desktop-app (with user accounts)
  - API endpoints require auth (api-spec.md has "Auth Required: Yes" entries)
  - Feature handles sensitive data (PII, financial, medical, credentials)
  
  SKIP this file when:
  - Project Type is: library, cli, compiler, build-tool, script (with no user system)
  - Project is an internal tool with no authentication layer
  - Project is a static site or documentation site with no user data
  - Authentication is entirely handled by an external gateway/proxy (document that fact in plan.md instead)
-->

## Overview

[Brief description of the security posture: who are the users, what are they protecting, and what's the threat model]

## Authentication

### Strategy

**Method**: [Choose one or combination based on research.md findings]
- [ ] Email/Password (with hashing)
- [ ] OAuth2 / OpenID Connect (Google, GitHub, etc.)
- [ ] Magic Link (passwordless email)
- [ ] API Key (for service-to-service)
- [ ] SSO / SAML (enterprise)
- [ ] Session-based (server-side sessions)
- [ ] JWT (stateless tokens)
- [ ] Multi-factor (TOTP, SMS, WebAuthn)
- [ ] Other: [specify]

### Token Lifecycle

<!--
  SKIP this section if using session-based auth with no tokens.
-->

| Token | Type | Storage | Expiry | Rotation |
|-------|------|---------|--------|----------|
| Access Token | JWT / opaque | [Memory / httpOnly cookie / header] | [e.g., 15min] | [On refresh] |
| Refresh Token | Opaque | [httpOnly cookie / secure storage] | [e.g., 7 days] | [On use — rotate] |
| API Key | Opaque | [Database hashed] | [Never / configurable] | [Manual revocation] |

**Token Signing**: [e.g., RS256 with rotating keys, HS256 with secret, or N/A]
**Revocation**: [Blocklist in Redis / DB flag / short expiry makes revocation unnecessary]

### Password Policy

<!--
  SKIP this section if no password-based auth.
-->

**Minimum Length**: [e.g., 12 characters]
**Complexity**: [e.g., no complexity requirements — length is sufficient per NIST 800-63B]
**Hashing**: [e.g., bcrypt cost 12, argon2id, scrypt]
**Breach Check**: [e.g., check against HaveIBeenPwned API on registration / No]
**Reset Flow**: [e.g., email with time-limited token (1hr), single-use]

### OAuth2 / Social Login

<!--
  SKIP this section if no OAuth2 providers.
-->

| Provider | Scopes | User Data Retrieved | Account Linking |
|----------|--------|--------------------|-----------------| 
| [e.g., Google] | `openid email profile` | Email, name, avatar | [Link to existing by email] |
| [e.g., GitHub] | `read:user user:email` | Email, username | [Link to existing by email] |

**New Account Flow**: [Auto-create on first OAuth login / require registration first]
**Account Linking**: [Allow multiple providers per account / one provider only]

## Authorization

### Model

**Type**: [Choose based on project complexity]
- [ ] RBAC (Role-Based Access Control) — roles with fixed permissions
- [ ] ABAC (Attribute-Based Access Control) — policy-based on attributes
- [ ] Resource-level — owner/collaborator/viewer per resource
- [ ] Simple (authenticated vs unauthenticated only)
- [ ] None — all authenticated users have equal access

### Roles & Permissions

<!--
  SKIP this section if using "Simple" or "None" authorization model.
  
  ACTION REQUIRED: Define roles from feature spec user stories.
  Each role should map to what that type of user can do.
-->

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| [e.g., Admin] | [Full system access] | [All CRUD, user management, settings] |
| [e.g., Member] | [Standard user] | [Own resource CRUD, read shared resources] |
| [e.g., Viewer] | [Read-only access] | [Read resources, no create/edit/delete] |

### Permission Matrix

<!--
  SKIP if roles table above is sufficient.
  Use this for fine-grained permission mapping.
-->

| Action | Admin | Member | Viewer | Public |
|--------|-------|--------|--------|--------|
| Create resource | ✅ | ✅ | ❌ | ❌ |
| Read own resource | ✅ | ✅ | ✅ | ❌ |
| Read any resource | ✅ | ❌ | ❌ | ❌ |
| Update own resource | ✅ | ✅ | ❌ | ❌ |
| Delete own resource | ✅ | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ | ❌ |

### Resource-Level Access

<!--
  SKIP if no per-resource ownership/sharing model.
-->

**Ownership**: [e.g., creator is owner, ownership is transferable / not transferable]
**Sharing**: [e.g., invite by email with role (editor/viewer), link sharing with expiry]
**Inheritance**: [e.g., workspace → project → item (permissions cascade down)]

## Input Validation & Sanitization

**Validation Layer**: [e.g., Zod schemas at API boundary, Pydantic models, class-validator]
**Sanitization**: [e.g., DOMPurify for HTML input, strip HTML tags, parameterized queries]

**Rules**:
- All user input validated at API boundary before reaching services
- SQL injection: parameterized queries only (no string concatenation)
- XSS: output encoding in templates, CSP headers
- File uploads: type validation, size limits, virus scanning ([if applicable])
- Path traversal: reject `..` in file paths, whitelist allowed paths

## Transport Security

**TLS**: [e.g., TLS 1.2+ required, TLS 1.3 preferred]
**HSTS**: [e.g., `Strict-Transport-Security: max-age=31536000; includeSubDomains`]
**Certificate**: [e.g., Let's Encrypt auto-renewal, managed by cloud provider]

### Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | [e.g., `default-src 'self'`] | Prevent XSS, injection |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` or `SAMEORIGIN` | Prevent clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer leakage |
| `Permissions-Policy` | [e.g., `camera=(), microphone=()`] | Restrict browser features |

### CORS Configuration

**Allowed Origins**: [e.g., `https://app.example.com`, or `*` for public API]
**Allowed Methods**: [e.g., `GET, POST, PUT, DELETE, OPTIONS`]
**Allowed Headers**: [e.g., `Authorization, Content-Type, X-Request-ID`]
**Credentials**: [e.g., `true` if using cookies, `false` for token-only]

## Data Protection

### Encryption

**At Rest**: [e.g., AES-256 via cloud provider disk encryption, application-level field encryption for PII]
**In Transit**: [TLS — covered in Transport Security above]
**Sensitive Fields**: [List fields requiring application-level encryption: SSN, payment info, etc., or none]

### Data Retention

<!--
  SKIP if no compliance requirements.
-->

| Data Type | Retention Period | Deletion Method |
|-----------|-----------------|----------------|
| [e.g., User accounts] | [Until deletion requested] | [Soft delete → hard delete after 30 days] |
| [e.g., Audit logs] | [1 year] | [Automated purge] |
| [e.g., Session data] | [24 hours after expiry] | [TTL-based auto-expire] |

### PII Handling

<!--
  SKIP if the project stores no personally identifiable information.
-->

**PII Fields**: [e.g., email, name, phone, address, IP address]
**Access Logging**: [Log all access to PII fields / no]
**Export**: [GDPR data export endpoint / manual process / not applicable]
**Deletion**: [Right to be forgotten — cascade delete all user data / anonymize]

## Rate Limiting & Abuse Prevention

| Endpoint Category | Limit | Window | Key |
|-------------------|-------|--------|-----|
| Authentication (login) | [e.g., 5 attempts] | [15 minutes] | [IP + email] |
| API (authenticated) | [e.g., 100 requests] | [1 minute] | [User ID] |
| API (public) | [e.g., 20 requests] | [1 minute] | [IP address] |
| Password reset | [e.g., 3 requests] | [1 hour] | [Email] |

**Lockout Policy**: [e.g., temporary lockout after 10 failed logins (30min), or CAPTCHA after 3]
**Bot Protection**: [e.g., CAPTCHA on registration, honeypot fields, or none]

## Audit Logging

<!--
  SKIP if the project has no compliance or audit requirements.
-->

**Events to Log**:
- Authentication: login success/failure, logout, token refresh, password change
- Authorization: permission denied, role changes
- Data: create/update/delete of sensitive resources
- Admin: user management actions, configuration changes

**Log Format**: [e.g., structured JSON with: timestamp, actor, action, resource, IP, result]
**Storage**: [e.g., separate audit table, append-only log, external SIEM]
**Retention**: [e.g., 1 year minimum, immutable]

## Dependency Security

**Vulnerability Scanning**: [e.g., `npm audit` / `pip-audit` / Dependabot / Snyk / none]
**Update Policy**: [e.g., critical patches within 48hrs, regular updates monthly]
**Lock Files**: [e.g., pnpm-lock.yaml committed, pip freeze, go.sum]

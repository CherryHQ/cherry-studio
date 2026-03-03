# API Specification: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Input**: data-model.md, research.md, spec.md

<!--
  GENERATION CONDITION:
  Only generate this file when ANY of these are true:
  - Project Type contains: web-service, api, saas, web-app
  - contracts/ includes HTTP/REST/GraphQL/gRPC endpoint definitions
  - Feature spec references API endpoints, webhooks, or external integrations
  
  SKIP this file when:
  - Project Type is: library, cli, compiler, build-tool, script
  - Project has no network-facing interfaces
  - Project is purely a frontend SPA consuming an existing external API (no custom backend)
-->

## Overview

[Brief description of what this API does, who consumes it, and its relationship to the feature]

## Base Configuration

**Base URL**: [e.g., `https://api.example.com/v1` or NEEDS CLARIFICATION]
**Versioning Strategy**: [e.g., URL path `/v1/`, header `Accept-Version`, query param, or NEEDS CLARIFICATION]
**Protocol**: [REST / GraphQL / gRPC / WebSocket / mixed]
**Content Type**: [e.g., `application/json`, `application/protobuf`]

## Authentication

<!--
  Cross-reference auth-security.md if generated. Keep this section as a summary;
  detailed auth flows belong in auth-security.md.
-->

**Method**: [e.g., Bearer JWT, API Key in header, OAuth2 client credentials, session cookie, or none]
**Header**: [e.g., `Authorization: Bearer <token>`, `X-API-Key: <key>`]
**Public Endpoints**: [List any endpoints that do NOT require authentication]

## Endpoints

<!--
  ACTION REQUIRED: Replace the sample endpoints below with actual endpoints
  derived from:
  - User stories in spec.md (each story may map to 1+ endpoints)
  - Entities in data-model.md (CRUD operations)
  - Research findings in research.md (third-party integration patterns)
  
  Use the format below consistently. Group by resource/domain, not by HTTP method.
-->

### [Resource 1: e.g., Users]

#### `[METHOD] [PATH]` — [Short description]

**Auth Required**: [Yes/No]
**User Story**: [US1, US2, etc.]

**Request**:
```json
{
  "field1": "type — description",
  "field2": "type — description (optional)"
}
```

**Query Parameters** *(if GET)*:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `page` | integer | No | Page number (default: 1) |
| `limit` | integer | No | Items per page (default: 20, max: 100) |

**Response** `200`:
```json
{
  "id": "string — unique identifier",
  "field1": "type — description",
  "created_at": "ISO 8601 datetime"
}
```

**Error Responses**:
| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request body failed validation |
| 401 | `UNAUTHORIZED` | Missing or invalid auth token |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Resource already exists |

---

### [Resource 2: e.g., Orders]

#### `[METHOD] [PATH]` — [Short description]

[Same structure as above]

---

[Add more resources as needed]

## Common Patterns

### Error Response Format

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description",
    "details": [
      { "field": "email", "issue": "Invalid format" }
    ]
  }
}
```

### Pagination

**Strategy**: [Cursor-based / Offset-based / Keyset]

```json
{
  "data": [],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "has_next": true,
    "next_cursor": "abc123"
  }
}
```

### Rate Limiting

**Limits**: [e.g., 100 req/min per API key, 1000 req/hour per user, or N/A]
**Headers**:
- `X-RateLimit-Limit`: Max requests per window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when window resets
**Exceeded Response**: `429 Too Many Requests`

## Webhooks *(if applicable)*

<!--
  SKIP this section if the project does not send outbound event notifications.
-->

**Delivery**: [e.g., HTTP POST to registered URL]
**Retry Policy**: [e.g., 3 retries with exponential backoff]
**Signature**: [e.g., HMAC-SHA256 in `X-Webhook-Signature` header]

| Event | Trigger | Payload |
|-------|---------|---------|
| `[resource].[action]` | [When this happens] | [Key fields in payload] |

## OpenAPI / Schema Generation

<!--
  NOTE: If the project uses a framework that auto-generates OpenAPI specs
  (e.g., FastAPI, NestJS, Spring Boot), note that here and reference the
  generated spec path. This document then serves as the human-readable
  design intent; the generated spec is the machine-readable source of truth.
-->

**Auto-generated**: [Yes/No]
**Spec Path**: [e.g., `backend/openapi.yaml` or N/A]
**Framework**: [e.g., FastAPI auto-generates from type hints]

# Agent Note: Sign in with Google for the Vertex AI provider

Status: proposed

English | [中文](2026-11-09-vertex-google-sign-in.zh.md)

## Problem

The Vertex AI provider authenticates only with a pasted service-account key. Organisations that roll Cherry out to staff must mint, send, track and revoke one long-lived key per person (or share one key). A key cannot be tied to a person's account lifecycle, so a leaver keeps access until someone revokes their key by hand. Many organisations forbid service-account key creation outright.

Vertex itself accepts a person's own Google OAuth token, so access can follow the person's Google account and IAM group membership instead. Cherry has no way to obtain or refresh that token today, and no way for an administrator to hand staff a ready-made Vertex configuration on devices the administrator does not manage.

## Proposal

Add a second Vertex sign-in method, **Sign in with Google**, next to the existing service-account key.

- **Settings.** Vertex AI settings gain a `Service account key | Sign in with Google` picker. Google mode takes an OAuth client ID and secret from a Desktop-app OAuth client that the organisation creates in its own Google Cloud project, then shows Sign in / Sign out and the signed-in email. Project and location stay shared between both modes.
- **Flow.** Main runs authorization code + PKCE through the existing `PkceOAuthClient` and `LoopbackCallbackTransport` (fixed `127.0.0.1` port; Desktop clients accept any loopback port), scope `openid email cloud-platform`, `access_type=offline`. `PkceOAuthClient` gains an optional `clientSecret`, which Google Desktop clients require on the token endpoint.
- **Storage.** The refresh token is stored inside the existing `iam-gcp` authConfig as `credentials: { type: 'authorized_user', clientId, clientSecret, refreshToken, account }`. `OAuthRuntimeService` is not used because its token store replaces the whole authConfig with `oauth`, which would drop project and location. No schema or migration change: `credentials` is already a free-form record.
- **Secrecy.** `GET /providers/:id/auth-config` strips the refresh token and returns `signedIn: true`; `PATCH /providers/:id` restores the stored token when the incoming config keeps the same OAuth client, so editing project or location never signs the person out.
- **Requests.** Chat (`buildVertexConfig`), partner models (MaaS) and model listing pass the signed-in user as `googleAuthOptions` with `authorized_user` credentials. That needs the Node build of `@ai-sdk/google-vertex` (google-auth-library refreshes the token); service-account keys keep using the edge build unchanged.
- **Setup link.** `cherrystudio://providers/vertex-google?v=1&data=<base64 JSON {project, location, clientId, clientSecret}>` opens Vertex settings and, after the person confirms a dialog showing the project, location and client ID, fills in Google mode. It never signs in by itself. This lets an administrator send one link to staff on unmanaged devices.

Out of scope: OpenClaw's legacy Vertex path (keeps service-account keys), Workload Identity Federation, and any Cherry-hosted OAuth client.

## Alternatives considered

- **Ship a Cherry-owned OAuth client ID.** One client for all users means Cherry, not the organisation, owns consent-screen verification for the sensitive `cloud-platform` scope, and every organisation's tokens hang off a client it cannot audit or restrict to its domain. Rejected; each organisation registers its own Internal client.
- **Read Application Default Credentials (`gcloud auth application-default login`).** Requires installing the Google Cloud CLI and running a terminal command, which non-technical staff cannot do, and the ADC file is shared with every other tool on the machine.
- **Route through `OAuthRuntimeService`.** Its provider-scoped token store overwrites authConfig with `type: 'oauth'` and resets to `api-key` on logout, losing Vertex project/location. Generalising the store is the README's deferred "General OAuth" move; not justified for one provider.
- **Store the refresh token in a separate encrypted file.** Service-account private keys already live in the same authConfig; a second store adds lifecycle and migration cost for no stronger guarantee. The token is instead kept out of the renderer.
- **Keep the edge SDK and inject a bearer header.** The edge wrapper always calls its own JWT signer first and throws without service-account credentials, so a header override cannot bypass it.

## Acceptance criteria

- AC1 — In Google mode, a person signs in through the browser and Vertex settings show "Signed in as <email>"; signing out revokes the token at Google and clears it locally while keeping the client ID and secret (verification: Electron)
- AC2 — With a Google sign-in and no service-account key, chat replies through the Vertex provider in both assistant chat and agent runtimes, and Sync models lists the project's models (verification: Electron)
- AC3 — The renderer never receives the refresh token, and saving other Vertex settings keeps the person signed in unless the OAuth client ID changes (verification: unit)
- AC4 — Chat requests for a signed-in user carry `googleAuthOptions` with `authorized_user` credentials and no `googleCredentials`; a configured but signed-out provider fails with a "sign in with Google" message (verification: unit)
- AC5 — Existing service-account configurations behave exactly as before, including JSON import, location changes and model listing (verification: unit)
- AC6 — Opening a `cherrystudio://providers/vertex-google` link shows the project, location and client ID for confirmation, fills in Google mode only after confirmation, and rejects payloads missing any field (verification: unit)
- AC7 — Every new UI string exists in all shipped locales (verification: docs gate)

## Risks

- **Scope breadth.** `cloud-platform` covers all of Google Cloud for that person. Mitigation: the organisation's consent screen is Internal, and the person's IAM roles still bound what the token can do; docs recommend granting only `roles/aiplatform.user`.
- **Malicious setup link.** A link could point a person at an attacker's project so prompts are processed there. Mitigation: the confirmation dialog names the project and client and warns to continue only for a link from the person's administrator; the link never signs in automatically.
- **Fixed loopback port 29875.** Another process on that port blocks sign-in until it exits; the error says so.
- **Client secret distribution.** Google classes Desktop-client secrets as non-confidential; exposure grants nothing without a user sign-in in the organisation's domain.

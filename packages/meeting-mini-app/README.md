# Meeting Notes mini app

A standalone meeting transcript workspace using the existing [Mini App API](../../docs/references/mini-app/README.md).
No host changes, recording permissions or speech SDK are required.

## Build and install

From the repository root, after installing the repository's pinned Node/pnpm versions:

```sh
pnpm install
pnpm --filter @cherrystudio/meeting-mini-app test
pnpm --filter @cherrystudio/meeting-mini-app typecheck
pnpm --filter @cherrystudio/meeting-mini-app build
```

Install `packages/meeting-mini-app/meeting-notes.miniapp` from Cherry Studio's Mini Apps page.
Grant the declared network and file capabilities. The bundled `meeting-notes` skill provides
an entry to the installed app; it does not handle credentials or upload transcripts itself.

## Usage

Enter an existing ClawMouse account token in the app. Paste a transcript, import TXT/SRT,
or restore an exported JSON meeting. Save it, then select Generate to request a summary
and mind map. Successful summaries are saved before fetching the mind map. Stop waiting
cancels local polling, not the server job; continue generation to retrieve saved progress.
Export a meeting as Markdown or JSON, or delete it from the local history.

## Authentication and data

- Account verification uses `GET https://cherrymousetest.sonicrhino.cc/api/user.user/userinfo`
  with a `token` header. Both HTTP status and the business response must indicate success,
  with an identifiable user. Token issuance and expiry remain the account server's responsibility.
- Verify on entry, return to the app, once per minute while visible, and before each summary
  service request. Invalid responses, account changes or network failures close access and
  clear the in-memory token. Hidden apps pause periodic checks and resume verification on return.
- The token remains in memory and is never included in URLs, meeting files, model messages,
  summary requests or the package. Exiting clears local access; it does not revoke the server token.
- Generating sends the transcript and title to `https://work.sonicrhino.cc/api/v1/analyses`.
  The summary service receives no account token. This is a client entry gate, not protection
  against direct calls to that service, and does not add a meeting-specific account entitlement.
- Meetings are stored through `cherry.file` in this app's local directory. They are shared
  across tokens in the same Cherry Studio profile, not encrypted or isolated by account.
- No audio recording, live transcription, SMS login or token issuer is shipped with the app.

## Meeting branch presentation

The history/header composition and interactive React Flow mind map are adapted from the
ClawMouse meeting integration branch. Imported text is shown as paragraph cards; SRT
cards use only timestamps present in the file. No recording metadata is fabricated.

After text and mind-map generation, the app requests the existing `summary-image` HTML
report. Existing meetings can use Format summary without regenerating their text. Reports
are fetched only from the Meeting Mind origin and sanitized with DOMPurify before rendering
inside a shadow root. Scripts, embedded frames, links and input controls are removed;
report styles stay scoped to the report. Detailed notes retain the original Markdown.

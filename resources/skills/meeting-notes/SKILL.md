---
name: meeting-notes
description: Open the Meeting Notes mini app when the user asks to enter the meeting workspace or organize meeting transcripts into summaries and mind maps. This app does not record or transcribe audio.
---

# Meeting Notes

Use the available assistant `product_info` and `navigate` tools to offer the installed
Meeting Notes app at `/app/mini-app/cc.sonicrhino.meeting`. Verify that the product's
navigation routes include `/app/mini-app/$appId` before calling `navigate`.
The navigation result is a clickable entry, not proof that the app has opened.

The user enters their account access token in the app's password field. The app
validates it through `https://cherrymousetest.sonicrhino.cc/api/user.user/userinfo`
before displaying the workspace. Never ask for a token in chat,
place it in a tool argument or URL, generate a substitute, or claim to have validated it.

The user pastes or imports TXT, SRT or previously exported JSON inside the workspace.
Generating a summary sends the transcript to Meeting Mind at `work.sonicrhino.cc`;
the access token is never sent. Let the user start generation in the app.

If the app is not installed, direct the user to Mini Apps → install from file using
the administrator-provided `meeting-notes.miniapp`. If the assistant navigation tools
are unavailable, explain that the installed app can be opened from Mini Apps instead.
Do not modify the host, install an SDK, start recording, or send transcript contents
to a service from the skill.

---
title: Default user avatar replaced
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-04
---

## What changed

The built-in default user avatar is no longer the green rounded square with a
white person glyph. It is now a pink card with a smiling face.

## Why this matters to the user

Anyone who has never set an avatar sees the new image — not only fresh
installs, but also existing users upgrading from an earlier build, because the
default is what shows whenever the `app.user.avatar` preference is empty. It
appears in the sidebar, on their own chat messages, and in the profile dialog.
Resetting the avatar from the profile dialog also now restores this new image.

## What the user should do

Nothing — automatic. A custom uploaded image or emoji avatar is untouched.

## Notes for release manager

Cosmetic only; no data is migrated or lost. Worth a screenshot in the release
note since existing users will notice their own avatar change without having
touched any setting.

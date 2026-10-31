---
icon: calendar
---

# Calendar and Reminders

Calendars suit activities with start and end times. Reminders suit things you need to complete. Ask your agent to check existing items first, then create or update the right one.

Built-in calendar tools use calendars accessible through your phone's system on iOS and Android. Built-in reminders currently support iOS only. Feishu, DingTalk, and other services use their own [plugins](plugins.md); granting phone calendar access does not connect those accounts.

## Before you start

1. Select a text model that supports tool calls.
2. Edit the current agent and enable **Calendar** or **Reminders** in its **System** section.
3. Grant permission when prompted, or check access under **Settings → System Permissions**.
4. To review creation, changes, and deletion before execution, set the agent's approval mode to **Ask when needed**.

Read and write permissions may differ. Being able to create an event does not imply access to read all events. A read-only calendar cannot accept new or updated events.

## Check tomorrow's schedule

Identify the calendar first, especially with multiple accounts or duplicate names:

> List the calendars available on my phone and tell me which are writable. Do not make changes.

Then specify a range:

> Read tomorrow's events in my Work calendar. Sort by time and list the start, end, title, and location.

Each query covers at most 90 days and returns at most 200 events or reminders. For larger collections, query by week or month. One returned list may not contain every record.

## Create an event

> In my Personal calendar, create “Organize travel details” tomorrow from 15:00 to 15:30, Beijing time. Set the location to Home and the notes to “Check tickets and accommodation.”

Specify the **date, time zone, start and end time, and calendar**. Explicit zones such as Beijing time or Tokyo local time help with travel and remote meetings.

After saving, ask the agent to read that time range again to confirm the event exists. If the outcome is uncertain, check the system calendar before retrying.

### Can it invite people, repeat events, or set advance alerts?

The current built-in tools do not expose attendee invitations, recurrence rules, or a separate advance-alert setting. An event with a meeting title does not automatically send invitations. Configure these details in the system calendar, or use an office plugin with the relevant capability.

## Update or delete an existing event

Find and identify the event before changing it:

> Find tomorrow's 15:00 “Organize travel details” event in my Personal calendar. Tell me its current time and location first.

After checking:

> Move that event to 16:00–16:30. Keep the location and notes unchanged.

Before deleting, also check the title, date, and calendar. Deleting the chat does not restore a deleted event.

## Manage to-dos with Reminders on iOS

| Goal | Example request |
| --- | --- |
| Choose a list | “List my reminder lists and tell me which are writable.” |
| Add an item | “Add ‘Post parcel’ to Personal, due tomorrow at 9 a.m. Beijing time, with the note ‘Bring the return slip.’” |
| Find unfinished items | “List this week's incomplete reminders in Personal, organized by due time.” |
| Change the date | “Move the due time of the ‘Post parcel’ item we just checked to 2 p.m. tomorrow. Keep everything else.” |
| Complete an item | “Mark that ‘Post parcel’ reminder as completed.” |
| Delete an item | “Delete only the ‘Post parcel’ item we just confirmed, leaving other items with that name.” |

Completing an item retains it with a changed status; deleting removes it. Tools can set start dates, due dates, and written notes. If you need a timed notification, confirm the alert settings and notification permissions in the system Reminders app.

**A location written on a reminder is a note, not an arrival-triggered alert.** Set complex repeats or location triggers in the system app. Date-filtered results are not necessarily the whole list; check undated items there too.

## Why does Android open the system calendar?

When some Android devices cannot complete an operation directly, the app may open a system calendar page:

* **Creation form:** check the date and content, select the intended calendar, and save manually.
* **Existing event page:** inspect current values and apply any remaining changes manually. Your requested changes may not be filled in.

Opening that page does not tell Cherry Studio whether you saved it. If a write times out or its outcome is uncertain, it may already have completed. Check the calendar before creating another event.

## A calendar or item is missing

First confirm the account and record exist in the system Calendar or Reminders app. Then check Cherry Studio permissions, the date range, and the selected calendar. Enterprise restrictions, read-only subscriptions, or material not synced to the phone can limit access.

See [Let AI Use Tools](using-tools.md) for approval behavior and [Data, Privacy, and Permissions](data-privacy.md) for system access and data use.

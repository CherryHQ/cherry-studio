---
description: Revert to original V1 data, and safely handle V2 backups, database, and Agent data.
icon: arrow-rotate-left
---
# Downgrading from V2 to V1

Downgrading is suitable when V2 temporarily disrupts critical workflows and you still have usable V1 data. It does not convert V2 data into V1 format.

{% hint style="danger" %}
New sessions, Agents, settings, and files added in V2 will not return to V1. V2 backups cannot be restored to V1; before downgrading, keep the latest V2 backup and the original V1 backup or a copy of the data directory separately.
{% endhint %}

## Standard Downgrade

{% stepper %}
{% step %}
### Stop Tasks and Back Up V2

End any running conversations, Agents, and file processing tasks. Create a new full V2 backup in **Settings** → **Data** and save it outside the application data directory.
{% endstep %}

{% step %}
### Verify V1 Data Is Still Available

Locate the V1 data directory copy or V1 backup retained before the upgrade. If you only have a V1 backup, you must restore it in a compatible V1 version; it cannot be imported into V2.
{% endstep %}

{% step %}
### Download and Install V1

Completely exit V2, obtain the installer matching your current system from the [Official V1 Download](https://cherryai.com/download/v1), and complete the installation.
{% endstep %}

{% step %}
### Launch Using Original V1 Data

Start V1 and use the V1 data directory from before the upgrade. Do not overwrite it with the V2 database or V2 backups.
{% endstep %}

{% step %}
### Verify Before Resuming Work

Check common sessions, model services, knowledge bases, and files. Do not delete any V1 or V2 backups until you have confirmed that V1 data is functioning correctly.
{% endstep %}
{% endstepper %}

{% hint style="info" %}
Standard downgrading does not require deleting the database. Retaining V2 data allows you to return to V2 later and prevents accidental deletion of content that has not yet been exported.
{% endhint %}

{% hint style="danger" %}
**Settings** → **Data** → **Re-migrate** in V2 is not a downgrade entry point. It permanently deletes current V2 data and re-imports from the original V1 data. Do not click this unless a previous V1 migration failed or missed data.
{% endhint %}

## When to Handle the V2 Database

You only need to take action in the following cases:

* You explicitly abandon all current V2 data and keep only V1 data;
* You need to re-execute a V1 → V2 migration.

This is not a standard downgrade step. The operation affects all V2 sessions, Agents, settings, and other data, not just a batch of test records.

### Safe Handling Method

1. Completely exit V1 and V2, ensuring no background tasks are running.
2. Open **Settings** → **Data** → **Application Data** in V1 1.9.13 to access the current application data directory.
3. Move the following items to the desktop or another safe location; do not delete them directly:
   * `Data/cherrystudio.sqlite`
   * `Data/cherrystudio.sqlite-shm` and `Data/cherrystudio.sqlite-wal` (if present)
   * `Data/Agents/.claude`
4. Launch V1 and check the original V1 data. If re-migration is required, start V2 to complete the migration.
5. Only decide whether to delete the previously moved files after confirming that V1 data is usable and V2 backups are accessible.

{% hint style="danger" %}
Do not move the database while the application is running. Do not move only `cherrystudio.sqlite` while missing `-shm` or `-wal` files in the same directory. Do not replace the V2 database with the V1 database. If you are unsure about the current data directory or file purposes, stop the operation and contact the Cherry Studio support team.
{% endhint %}

## FAQ

<details>

<summary>Can new conversations in V2 be brought back to V1?</summary>

No. Please export any content you need to keep in V2. V1 will only continue using the original V1 data.

</details>

<details>

<summary>Does downloading V1 automatically convert V2 data?</summary>

No. The installer only installs the application; it does not convert data or backup formats.

</details>

<details>

<summary>Can I directly delete the database and try again?</summary>

Not recommended. Move and retain the files first, then decide whether to delete them after verification. If you accidentally delete them and have no usable backup, V2 data may be unrecoverable.

</details>

<details>

<summary>If I downgrade and then return to V2, which version should I install?</summary>

If you continue using the previous V2 data, you can directly install V2 and must not click **Re-migrate**. If a previous V1 migration failed or missed data, you can use **Settings** → **Data** → **Re-migrate** after creating a full backup of the current V2 data; this operation permanently deletes current V2 data and re-imports from V1.

</details>

## References

* [Cherry Studio V1 Official Download](https://cherryai.com/download/v1)
* [Cherry Studio V2 Official Download](https://cherryai.com/download)
* V2 Release Page: [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
* [Issue Feedback and Feature Suggestions](../../question-contact/suggestions.md)

---
icon: users
---

# Accounts and organization spaces

Use your own model services, a Cherry Studio community account, an organization account, or a private deployment. **Sign-in identity, model entitlement, and the local data space are different:** history stays on the device, while model access and organization resources follow the current service's authorization.

## Sign in or switch

Open the profile area at the top of **Settings**, or sign in during first-use setup.

* **Cherry Studio account:** complete sign-in and choose a community or accessible organization space.
* **Private deployment:** enter the service address, username, and password supplied by your organization, rather than a model provider's API key.
* **Skip sign-in:** continue in the personal local space with your own model services.

Community/organization accounts can **Switch organization** or switch accounts. Private deployments use **Switch account** for another identity or service. Return from browser authorization and inspect the app's result; opening sign-in does not establish completion.

## Where did my conversations go after switching?

| Space | Data and resource ownership |
| --- | --- |
| Personal local space | Unsigned use and community accounts retain the existing personal device data. Switching or signing out of a community account does not automatically clear those chats |
| Organization or private-deployment space | Each organization service/identity has a separate local space with its chats, files, agents, and managed resources |

Switching reloads the selected space. **It does not merge histories or move personal files into an organization.** If earlier chats disappear from view, check the current space before deleting data or restoring another space's backup.

Signing out of an organization returns to the personal space. Re-entering the same organization identity makes its retained local data and resources available again. Local spaces are not cross-phone cloud synchronization; follow [backup and restore](backup-and-restore.md) when changing devices.

## Community accounts and CherryAI models

An existing entitled community account can use authorized models through the managed **CherryAI** provider and see service-reported plan/quota information. The account service determines available models and purposes; changing local names, prices, or capability flags cannot unlock them.

* Wait for account/catalog loading. Retry failures rather than interpreting them as zero balance.
* Sending still requires the model, purpose, validity period, and quota to permit it. A previously visible model does not guarantee every later request.
* Your own API providers retain their own credentials and charges; community sign-in does not grant those providers credits.
* Quota display is not a third-party provider's complete bill. Community entitlement does not make every model or plugin free.

## Why is organization configuration locked?

Organization-supplied providers, models, agents, instructions, skills, or tools may be locked or hidden. Their source is the organization service; the mobile editor is not its administration console.

Managed agents may allow selection from an approved model pool or local changes such as mode and approval preferences. Follow the fields actually available. Ask the organization administrator to address missing resources, rejected access, or additional permissions at the source.

## Sign-out and backup restore

Community sign-out keeps personal local chats, but account-authorized models may become unavailable. Organization sign-out has its own confirmation. Signing out does not delete organization data or revoke every third-party plugin authorization.

An organization backup restores only into the **same organization identity**, while personal backups restore into the personal space. Organization-delivered models, secrets, and tools are excluded and must be fetched online again. See [backup](backup-and-restore.md).

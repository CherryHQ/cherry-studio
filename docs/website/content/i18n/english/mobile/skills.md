---
icon: sparkles
---

# Skills: install and reuse workflows

Skills package instructions, steps, and reference material for tasks you repeat, such as research reports, meeting notes, or writing workflows.

A skill supplies a method. Models, connected tools, and permissions determine what can actually run. Installing a skill does not connect accounts, grant access, or make desktop commands executable on your phone.

## Start in the skill library

1. Open **Skills** in the sidebar and switch to **Discover skills**.
2. Search for your task, open a result, and read its instructions and limitations.
3. Tap **Install**. If a source contains several skills, select the entries you need.
4. Return to the installed list and open the skill to read its full document.

Switch between sources such as CherryIN and skills.sh. Discovery no longer filters by the old mobile-support label, so more entries can appear. Installation does not establish that every step works on a phone; check model, tool, and permission requirements.

## Install from a link or ask AI to find a skill

Choose **Add in chat** from the skill page's More menu, then describe a task or provide a public skills.sh or GitHub skill link. For example:

> Find a skill that turns meeting notes into an action list. Explain which tools it needs, then let me choose what to install.

> Install a skill from this public repository: [link]. If it contains several skills, list their names and purposes first.

Follow the candidate results to select and install. Sources must be publicly accessible; an ordinary webpage or private repository is not necessarily a supported source. On failure, keep the error details and check the link, network, and package format.

## Enable a skill for an agent

1. Open the target agent's editor and use **Standard** mode.
2. Choose **Add Skill** and select an installed, available entry. Remove it with the row's removal action instead of looking for the old switches.
3. Describe your task in chat, or explicitly reference the skill from the composer's skill picker.

**Enabling** makes the skill available for the agent to choose when relevant. **Referencing it in a message** explicitly requests its method for that task. Installation is shared across the app; each agent's bindings are separate. Selecting a skill in the composer does not create an agent binding; change long-term bindings in the editor. Minimal mode does not use skills; see [Agents and tools](agents-and-tools.md).

## Save your own method as a skill

Choose the skill creation action on the Skills page, or describe a reusable workflow in chat:

> Turn our weekly-report method into a skill: read the materials I supply, then organize progress, risks, and next week's plan. Ask for missing information instead of inventing it. Show me the complete instructions before saving.

Review the proposed name, description, and full steps. Confirm saving and whether to enable it for the current agent. Try it with a small sample before relying on it for a larger task.

## Read, translate, and update

* Read the full document in the details page. **AI translation** lets you choose a target language and return to the original. Translation helps reading; it does not change installed instructions or what the agent receives.
* Completed translations are saved locally and can be read again without another request. Changed skill content needs a new translation. See [Reply and skill-document translation](translation.md) for model settings.
* Use the update action to check or apply source updates. An update uses upstream content; preserve any local instructions you need before updating.
* Uninstalling removes the skill from all agents. Files it helped create remain in the file library.

## Why can an installed skill still fail?

| Situation | What to do |
| --- | --- |
| It needs Feishu or another account | Connect the [relevant plugin](plugins.md) and ensure the account can access the target material |
| It needs search, a calendar, or image generation | Use Standard mode and configure the model, service, and OS permissions; built-in capability switches are gone |
| It contains scripts or needs missing tools | Mobile does not run scripts bundled with skills; check which steps the app can perform |
| It is installed but absent from the composer | Check the agent binding, Standard mode, and whether the skill allows explicit invocation |
| Its instructions need adapting for mobile | Review the complete change summary, then choose to save the adaptation or keep the original |

Agents can now list/count installed skills, including unbound or globally disabled entries. Listing does not grant current-agent use; installation, global enablement, and bindings remain separate. Organization-delivered skills may follow organization policy.

Skills cannot expand permissions or change [tool approval rules](using-tools.md). The calculation tool runs restricted code written for the current task; it is not a runner for arbitrary programs bundled with a skill.

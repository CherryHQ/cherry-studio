# Test Plan

To provide users with a more stable application experience and faster iteration speed, Cherry Studio has launched the "Test Plan".

## User Guide

The Test Plan is divided into the RC channel and the Beta channel, with the following differences:

- **RC (Release Candidate)**: The features are stable, with fewer bugs, and it is close to the official release.
- **Beta**: Features may change at any time, and there may be more bugs, but users can experience future features earlier.

Users can enable the "Test Plan" and select the version channel in the software's `Settings` > `About`. Please note that the versions in the "Test Plan" cannot guarantee data consistency, so be sure to back up your data before using them.

Users are welcome to submit issues or provide feedback through other channels for any bugs encountered during testing. Your feedback is very important to us.

## Developer Guide

### Participating in the Test Plan

Developers should submit `PRs` according to the [Contributor Guide](../CONTRIBUTING.md) (and ensure the target branch is `main`). The repository maintainers will evaluate whether the `PR` should be included in the Test Plan based on factors such as the impact of the feature on the application, its importance, and whether broader testing is needed.

If the `PR` is added to the Test Plan, the repository maintainers will:

- Notify the `PR` submitter.
- Set the PR to `draft` status (to avoid accidental merging into `main` before testing is complete).
- Set the `milestone` to the specific Test Plan version.
- Modify the `PR` title.

During participation in the Test Plan, `PR` submitters should:

- Keep the `PR` branch synchronized with the latest `main` (i.e., the `PR` branch should always be based on the latest `main` code).
- Ensure the `PR` branch is conflict-free.
- Actively respond to comments & reviews and fix bugs.
- Enable maintainers to modify the `PR` branch to allow for bug fixes at any time.

Inclusion in the Test Plan does not guarantee the final merging of the `PR`. It may be shelved due to immature features or poor testing feedback.

### Test Plan Lead

A maintainer will be assigned as the lead for a specific version (e.g., `1.5.0-rc`). The responsibilities of the Test Plan lead include:

- Determining whether a `PR` meets the Test Plan requirements and deciding whether it should be included in the current Test Plan.
- Modifying the status of `PRs` added to the Test Plan and communicating relevant matters with the `PR` submitter.
- Before the Test Plan release, merging the branches of `PRs` added to the Test Plan (using squash merge) into the corresponding version branch of `testplan` and resolving conflicts.
- Ensuring the `testplan` branch is synchronized with the latest `main`.
- Overseeing the Test Plan release.

## In-Depth Understanding

### About `PRs`

A `PR` is a collection of a specific branch (and commits), comments, reviews, and other information, and it is the **smallest management unit** of the Test Plan.

Compared to submitting all features to a single branch, the Test Plan manages features through `PRs`, which offers greater flexibility and efficiency:

- Features can be added or removed between different versions of the Test Plan without cumbersome `revert` operations.
- Clear feature boundaries and responsibilities are established. Bug fixes are completed within their respective `PRs`, isolating cross-impact and better tracking progress.
- The `PR` submitter is responsible for resolving conflicts with the latest `main`. The Test Plan lead is responsible for resolving conflicts between `PR` branches. However, since features added to the Test Plan are relatively independent (in other words, if a feature has broad implications, it should be independently included in the Test Plan), conflicts are generally few or simple.

### The `testplan` Branch

The `testplan` branch is a **temporary** branch used for Test Plan releases.

Note:

- **Do not develop based on this branch**. It may change or even be deleted at any time, and there is no guarantee of commit completeness or order.
- **Do not submit `commits` or `PRs` to this branch**, as they will not be retained.
- The `testplan` branch is always based on the latest `main` branch (not on a released version), with features added on top.

#### RC Branch

Branch name: `testplan/rc/x.y.z`

Used for RC releases, where `x.y.z` is the target version number. Note that whether it is rc.1 or rc.5, as long as the major version number is `x.y.z`, it is completed in this branch.

Generally, the version number for releases from this branch is named `x.y.z-rc.n`.

#### Beta Branch

Branch name: `testplan/beta/x.y.z`

Used for Beta releases, where `x.y.z` is the target version number. Note that whether it is beta.1 or beta.5, as long as the major version number is `x.y.z`, it is completed in this branch.

Generally, the version number for releases from this branch is named `x.y.z-beta.n`.

### Version Rules

The application version number for the Test Plan is: `x.y.z-CHA.n`, where:

- `x.y.z` is the conventional version number, referred to here as the **target version number**.
- `CHA` is the channel code (Channel), currently divided into `rc` and `beta`.
- `n` is the release number, starting from `1`.

Examples of complete version numbers: `1.5.0-rc.3`, `1.5.1-beta.1`, `1.6.0-beta.6`.

The **target version number** of the Test Plan points to the official version number where these features are expected to be added. For example:

- `1.5.0-rc.3` means this is a preview of the `1.5.0` official release (the current latest official release is `1.4.9`, and `1.5.0` has not yet been officially released).
- `1.5.1-beta.1` means this is a beta version of the `1.5.1` official release (the current latest official release is `1.5.0`, and `1.5.1` has not yet been officially released).

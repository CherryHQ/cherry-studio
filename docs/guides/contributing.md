# Cherry Studio Contributor Guide

[**English**](../../CONTRIBUTING.md) | [中文](./contributing.md)

Welcome to the Cherry Studio contributor community! We are committed to making Cherry Studio a project that provides long-term value, and we invite more developers to join us. Whether you're an experienced developer or just getting started, your contributions will help us better serve users and improve software quality.

## How to Contribute

Here are several ways you can participate:

1. **Contribute Code**: Help develop new features or optimize existing code. Ensure your code meets our coding standards and passes all tests.
2. **Fix Bugs**: If you find a bug, feel free to submit a fix. Please verify the issue is resolved and include relevant tests.
3. **Maintain Issues**: Help manage GitHub issues by tagging, categorizing, and resolving problems.
4. **Product Design**: Participate in product design discussions to help improve user experience and interface design.
5. **Write Documentation**: Help us improve user manuals, API documentation, and developer guides.
6. **Community Maintenance**: Participate in community discussions, help answer user questions, and foster community activity.
7. **Promote Usage**: Promote Cherry Studio through blogs, social media, and other channels to attract more users and developers.

## Before You Start

Please make sure you've read the [Code of Conduct](../../CODE_OF_CONDUCT.md) and [LICENSE](../../LICENSE).

## Setting Up the Development Environment

Please refer to the [Developer Guide](./development.md) for instructions on setting up your local development environment, including prerequisites, installation steps, and available commands.

For a comprehensive overview of the project architecture, tech stack, code conventions, and available commands, please refer to [`CLAUDE.md`](../../CLAUDE.md).

## Getting Started

To familiarize yourself with the code, we recommend working on issues tagged with one or more of the following labels: [good-first-issue](https://github.com/CherryHQ/cherry-studio/labels/good%20first%20issue), [help-wanted](https://github.com/CherryHQ/cherry-studio/labels/help%20wanted), or [kind/bug](https://github.com/CherryHQ/cherry-studio/labels/kind%2Fbug). Any help is welcome.

### Testing

Features without tests are considered non-existent. To ensure code is truly effective, relevant processes should be covered by unit tests and functional tests. Therefore, when considering contributions, please also consider testability. All tests can be run locally without CI dependency. Please refer to the "Test" section in the [Developer Guide](./development.md#test).

### Automated Testing on Pull Requests

Automated tests are triggered on pull requests (PRs) opened by Cherry Studio organization members, excluding draft PRs. PRs from new contributors are initially labeled `needs-ok-to-test` and are not automatically tested. After a Cherry Studio organization member adds `/ok-to-test` to the PR, the test pipeline will be created.

### Consider Opening Your Pull Request as a Draft

Not all pull requests are ready for review when created. This may be because the author wants to start a discussion, isn't fully sure the changes are heading in the right direction, or the changes aren't yet complete. Consider creating these PRs as [draft pull requests](https://github.blog/2019-02-14-introducing-draft-pull-requests/). Draft PRs are skipped by CI, saving CI resources. This also means reviewers won't be automatically assigned, and the community will understand the PR isn't ready for review. After you mark a draft pull request as ready for review, reviewers will be assigned.

### Contributor Compliance with Project Terms

We require each contributor to certify they have the right to legally contribute to our project. Contributors express this by intentionally signing off on their commits, indicating compliance with the [LICENSE](../../LICENSE).
A signed-off commit contains the following in the commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

You can generate signed-off commits with the [git commit --signoff](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff) command:

```
git commit --signoff -m "Your commit message"
```

### Getting Code Review/Merged

Maintainers are here to help you achieve your use case in a reasonable timeframe. They will do their best to review your code and provide constructive feedback. But if you're blocked during review, or feel your Pull Request isn't getting the attention it deserves, please reach out through comments on the issue or [community channels](../../README.md).

### Participating in the Test Plan

The Test Plan aims to provide users with a more stable application experience and faster iteration speed. For details, please refer to the [Test Plan](./test-plan.md).

### Other Suggestions

- **Contact Developers**: Before submitting a PR, you can contact developers first to discuss or get help.

## Important Contribution Guidelines

Please read the following key information before submitting a Pull Request:

### Branch Strategy

**The v2 refactor has merged into `main`.** `main` is now the default branch for active development, where v1 and v2 code coexist. Expect large, frequent, and breaking changes during this phase.

- **`main` branch**: New feature development, refactoring, optimizations, and fixes for the current codebase go here. Before touching subsystems being replaced, read [docs/references/data](../references/data/README.md) to learn which are being deleted, and heed `@deprecated` annotations in the code — they mark call sites slated for removal.
- **`v1` branch**: Maintenance line for the shipped v1 release — its hotfixes and subsequent v1 releases go here, via `hotfix/*` branches (e.g., `hotfix/fix-crash-on-startup`), with minimal scope. Target your PR to `v1`, not `main`. A v1 fix does **not** auto-carry to `main`; if the same bug exists on `main`, open a separate forward-port PR targeting `main`.

### Participate in v2 Development

v2 is the next major milestone for Cherry Studio, and we invite every developer to actively participate! Whether it's new feature development, architecture optimization, or code refactoring, contributions on `main` are welcome. Let's build a better Cherry Studio together!

Thank you for your understanding and continued support during this important development phase!

## Contact Us

If you have any questions or suggestions, feel free to reach out:

- WeChat: kangfenmao
- [GitHub Issues](https://github.com/CherryHQ/cherry-studio/issues)

Thank you for your support and contributions! We look forward to building a better Cherry Studio with you.

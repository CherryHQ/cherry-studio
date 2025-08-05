[中文](docs/CONTRIBUTING.zh.md) | [English](CONTRIBUTING.md)

# Cherry Studio Contributor Guide

Welcome to the Cherry Studio contributor community! We are committed to making Cherry Studio a project that provides long-term value and hope to invite more developers to join us. Whether you are an experienced developer or a beginner just starting out, your contributions will help us better serve users and improve software quality.

## How to Contribute

Here are several ways you can participate:

1.  **Contribute Code**: Help us develop new features or optimize existing code. Please ensure your code adheres to our coding standards and passes all tests.

2.  **Fix Bugs**: If you find a bug, you are welcome to submit a fix. Please confirm the issue is resolved before submitting and include relevant tests.

3.  **Maintain Issues**: Help us manage issues on GitHub by assisting with tagging, classifying, and resolving problems.

4.  **Product Design**: Participate in product design discussions to help us improve user experience and interface design.

5.  **Write Documentation**: Help us improve the user manual, API documentation, and developer guides.

6.  **Community Maintenance**: Participate in community discussions, help answer user questions, and promote community activity.

7.  **Promote Usage**: Promote Cherry Studio through blogs, social media, and other channels to attract more users and developers.

## Before You Start

Please make sure you have read the [Code of Conduct](CODE_OF_CONDUCT.md) and the [LICENSE](LICENSE).

## Getting Started

To help you get familiar with the codebase, we recommend tackling issues tagged with one or more of the following labels: [good-first-issue](https://github.com/CherryHQ/cherry-studio/labels/good%20first%20issue), [help-wanted](https://github.com/CherryHQ/cherry-studio/labels/help%20wanted), or [kind/bug](https://github.com/CherryHQ/cherry-studio/labels/kind%2Fbug). Any help is welcome.

### Testing

Features without tests are considered non-existent. To ensure code is truly effective, relevant processes should be covered by unit tests and functional tests. Therefore, when considering contributions, please also consider testability. All tests can be run locally without dependency on CI. Please refer to the "Testing" section in the [Developer Guide](docs/dev.md).

### Automated Testing for Pull Requests

Automated tests are triggered on pull requests (PRs) opened by members of the Cherry Studio organization, except for draft PRs. PRs opened by new contributors will initially be marked with the `needs-ok-to-test` label and will not be automatically tested. Once a Cherry Studio organization member adds `/ok-to-test` to the PR, the test pipeline will be created.

### Consider Opening Your Pull Request as a Draft

Not all pull requests are ready for review when created. This might be because the author wants to start a discussion, they are not entirely sure if the changes are heading in the right direction, or the changes are not yet complete. Please consider creating these PRs as [draft pull requests](https://github.blog/2019-02-14-introducing-draft-pull-requests/). Draft PRs are skipped by CI, thus saving CI resources. This also means reviewers will not be automatically assigned, and the community will understand that this PR is not yet ready for review.
Reviewers will be assigned after you mark the draft pull request as ready for review.

### Contributor Compliance with Project Terms

We require every contributor to certify that they have the right to legally contribute to our project. Contributors express this by consciously signing their commits, thereby indicating their compliance with the [LICENSE](LICENSE).
A signed commit is one where the commit message includes the following:

You can generate a signed commit using the following command [git commit --signoff](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff):

```
git commit --signoff -m "Your commit message"
```

### Getting Code Reviewed/Merged

Maintainers are here to help you implement your use case within a reasonable timeframe. They will do their best to review your code and provide constructive feedback promptly. However, if you get stuck during the review process or feel your Pull Request is not receiving the attention it deserves, please contact us via comments in the Issue or through the [Community](README.md#-community).

### Participating in the Test Plan

The Test Plan aims to provide users with a more stable application experience and faster iteration speed. For details, please refer to the [Test Plan](docs/testplan-en.md).

### Other Suggestions

- **Contact Developers**: Before submitting a PR, you can contact the developers first to discuss or get help.
- **Become a Core Developer**: If you contribute to the project consistently, congratulations, you can become a core developer and gain project membership status. Please check our [Membership Guide](https://github.com/CherryHQ/community/blob/main/docs/membership.en.md).

## Contact Us

If you have any questions or suggestions, feel free to contact us through the following ways:

- WeChat: kangfenmao
- [GitHub Issues](https://github.com/CherryHQ/cherry-studio/issues)

Thank you for your support and contributions! We look forward to working with you to make Cherry Studio a better product.

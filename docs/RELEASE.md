# The reusable release

The sibling of [the reusable gate](./REUSABLE-GATE.md): the gate answers "is
this repo green?", this cuts the version when it is. A repo releases by calling
it and never copies release-please config, the pinned action, or token handling.

## Adopt it

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  cordon:
    permissions:
      contents: write
      pull-requests: write
    uses: joeseverino/cordon/.github/workflows/cordon-release.yml@v2
    # with: { release-type: node }   # default: simple (version.txt)
```

The status check is `cordon / release`. Once per repo, allow Actions to open
pull requests:

```sh
gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow \
  -F can_approve_pull_request_reviews=true
```

## How a release happens

[`cordon-release.yml`](../.github/workflows/cordon-release.yml) runs
[release-please](https://github.com/googleapis/release-please) on every push to
`main`:

1. it reads the Conventional Commit titles since the last release and computes
   the next version (`fix` → patch, `feat` → minor, `feat!` or `BREAKING CHANGE`
   → major);
2. it keeps one standing release PR, `chore(main): release X.Y.Z`, that bumps
   the version and regenerates `CHANGELOG.md`;
3. merging that PR cuts the `vX.Y.Z` tag and the GitHub Release.

Each run writes one line to the run summary: released, release PR ready, or
nothing to release. The workflow also returns `release_created` and `tag_name`,
so a caller can publish in a job that `needs:` it (cordon's own
[`release.yml`](../.github/workflows/release.yml) does).

## Inputs

| Input | Default | What |
| --- | --- | --- |
| `release-type` | `simple` | `simple` (`version.txt`), `node`, `python`, …, or `manifest` to read `release-please-config.json` |
| `float-major` | `false` | Move a `vN` tag to each new `vN.x.y`, so callers can follow `@vN` |
| `app-client-id` | | A GitHub App to open release PRs as (with the `app-private-key` secret) |

`manifest` is for a repo that versions several files together. cordon uses it to
keep the npm package and the Python emitter on one version.

## Release PRs and required checks

A pull request opened with the default `GITHUB_TOKEN` never triggers workflows,
so a required `cordon / gate` never reports on the release PR and it cannot
merge without an admin override. Give the workflow a GitHub App and the release
PR is opened as the app, which does trigger CI:

1. create a GitHub App with Contents and Pull requests read/write, and install
   it on the repos that release;
2. store its private key as the `RELEASE_APP_PRIVATE_KEY` secret;
3. pass both:

```yaml
    with:
      app-client-id: <the app's client ID>
    secrets:
      app-private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
```

## Versions

`@v2` follows the latest 2.x release, the same way the gate does. Pin
`@vX.Y.Z` to freeze it; Dependabot keeps that reference and the pinned
release-please action current.

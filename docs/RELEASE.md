# The reusable release

One workflow, reused by every Severino repo, so release logic lives in exactly
one place. The sibling of [the reusable gate](./REUSABLE-GATE.md): the gate
answers *"is this repo green?"*, this **cuts the version when it is**. A repo
releases by *calling* it — it never copies release-please config, the pinned
action, or token plumbing.

## Adopt it (the whole release file)

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
jobs:
  cordon:
    uses: joeseverino/cordon/.github/workflows/cordon-release.yml@main
    # release-type defaults to "simple" (a version.txt). A typed repo overrides:
    # with: { release-type: node }   # or python, go, …
```

That's the entire release surface of a consuming repo. The status check is
`cordon / release` — the sibling of the gate's `cordon / gate`.

## The one-time per-repo setting (required)

GitHub blocks Actions from opening PRs by default, so **once per repo**:

> **Settings → Actions → General → Workflow permissions →**
> ✅ **"Allow GitHub Actions to create and approve pull requests"**

Or via the CLI:

```bash
gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow \
  -F can_approve_pull_request_reviews=true
```

Without it the release PR cannot be opened and the run fails with
*"GitHub Actions is not permitted to create or approve pull requests."*
This is the only manual step, and it is per repo.

## How a release happens

[`cordon-release.yml`](../.github/workflows/cordon-release.yml) runs
[release-please](https://github.com/googleapis/release-please) on every push to
`main`:

1. it reads the Conventional Commit titles since the last release and computes
   the next SemVer (`fix`→patch, `feat`→minor, `feat!`/`BREAKING CHANGE`→major);
2. it maintains **one standing release PR** — `chore(main): release X.Y.Z` —
   that bumps the version file and regenerates `CHANGELOG.md`;
3. **merging that PR** cuts the `vX.Y.Z` tag and the GitHub Release. Nothing
   ships until then — the release PR is your review-and-iterate surface (let more
   work accumulate, or set `Release-As: X.Y.Z` in a commit to force a number).

## Pick a `release-type`

Logic is central; the version source is local. `simple` is the default so a
brand-new repo needs no manifest at all.

| `release-type` | Version lives in | Use for |
| --- | --- | --- |
| `simple` (default) | `version.txt` | anything without a package manifest (shell tools, docs, the starter) |
| `node` | `package.json` | npm packages (cordon itself) |
| `python` | `pyproject.toml` / `__init__.py` | Python apps + libs |

For `simple`, seed a `version.txt` (e.g. `0.1.0`) once; the typed strategies
read the version from the manifest you already have, so they need nothing extra.

## Changing things

- **Release behavior for every repo** → edit `cordon-release.yml` here. One
  change, all repos.
- **A repo's version source** → its `release-type:` line (and `version.txt` for
  `simple`).
- **Gated release PRs** → pass a PAT/App token as the `token` secret so the
  release PR re-triggers the gate; otherwise it's opened with `GITHUB_TOKEN`,
  which (by design) doesn't re-trigger `pull_request` workflows. Review by hand
  until you wire a token.

## Pinning the release workflow

`@main` tracks the latest. Pin `@<tag>` (or a SHA) for reproducibility;
Dependabot (github-actions ecosystem) keeps both that reference and the pinned
release-please action current.

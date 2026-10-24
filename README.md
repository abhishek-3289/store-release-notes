# Store Release Notes 📝

[![My Skills](https://skillicons.dev/icons?i=githubactions,github,nodejs&perline=3)](https://skillicons.dev)

## Use 📄

### Example ⌨️

```yaml
    permissions:
      contents: read
      issues: read
      pull-requests: read

    steps:
      - name: Checkout code
        uses: actions/checkout@v7

      - name: Build release notes
        id: notes
        uses: appshipkit/store-release-notes@v1
        with:
          milestone: v1.5.0
          version: 1.5.0
          header: v{version}
          sections: 'feature:✨ New,bug:🐛 Fixes,improvement:⚡ Improvements'
          locales: en-US,de-DE
          play-dir: distribution/whatsnew
          appstore-file: fastlane/metadata/en-US/release_notes.txt

      - name: Output release notes
        env:
          PLAY_NOTES: ${{ steps.notes.outputs.play-notes }}
          PR_COUNT: ${{ steps.notes.outputs.pr-count }}
          TRUNCATED: ${{ steps.notes.outputs.truncated }}
        run: |
          echo "$PLAY_NOTES"
          echo "$PR_COUNT pull requests, truncated: $TRUNCATED"
```

### Description 🔖

A GitHub Action which builds app-store _What's new_ text from merged pull requests and writes it in the
formats Google Play and the App Store expect. It pairs with
[milestone-version-increment](https://github.com/appshipkit/milestone-version-increment): that action
creates (or returns) the `v1.5.0` milestone, pull requests are added to it during the cycle, and this action
turns them into store notes when you ship.

**Source of changes** — exactly one of:

- `milestone`: a milestone title (or number). Every closed issue in the milestone is listed and only pull
  requests with a merge time are kept, so closed-but-unmerged pull requests and plain issues are ignored.
- `from-tag` (plus optional `to-ref`, default the workflow commit): every commit between the two refs is
  listed and each commit's associated pull requests are looked up; merged ones are kept once each.

Giving neither or both fails the step.

**Filtering and sections**

- `exclude-labels` drops pull requests with any of the labels (default `skip-release-notes,internal,dependencies`).
  `include-labels`, when set, keeps only pull requests that carry at least one of its labels. Exclusions win.
  Label matching ignores case.
- `sections` maps labels to titles in priority order, e.g. `feature:✨ New,bug:🐛 Fixes`. Several labels can
  share one title. A pull request with labels from more than one section goes to the first one. Pull requests
  without a mapped label go to `other-section-title` (default `Other changes`), or are dropped with
  `include-unlabeled: false`. Without `sections` the notes are a flat list with no headings.
- Within a section, items are ordered by merge time, oldest first.

**Line text**

Each line is the pull request title, unless the body contains a release-note block or line. The block wins
over the line, and lines inside the block are joined with spaces:

```markdown
<!-- release-note -->
Checkout is faster on slow networks
<!-- /release-note -->

Release note: Checkout is faster on slow networks
```

With `clean-titles: true` (default) leading ticket keys such as `ABC-123:`, `ABC-123 -` or `[ABC-123]`
(uppercase project keys) and conventional-commit prefixes such as `feat:`, `fix(scope):` or `feat!:` are
removed, repeated whitespace is collapsed and the first letter is capitalised.

**Format and store limits**

```text
v1.5.0

✨ New
- Share wishlists

🐛 Fixes
- Fixed a crash when opening the app offline

Other changes
- Tidy settings screen
```

`header` is an optional first line; `{version}` in it is replaced with the `version` input, so `v{version}`
produces the version line that `release-notes/whatsnew-*.txt` files usually start with. A flat list (no
sections) follows the header directly, matching that file style.

Google Play allows 500 characters per locale and the App Store 4000. Characters are counted as Unicode code
points, so `🎉` counts once, while multi-code-point emoji such as flags or family emoji count as several. When
the text is too long, whole items are removed from the end of the lowest-priority section first (the other
section, then the last mapped section, and so on), an emptied section loses its heading, and a final
`…and more` line is added. Lines are never cut in the middle. If the header alone cannot fit, the step fails.
The two texts are fitted independently, so the App Store text usually keeps more items.

**Files**

| input           | written files                              | used by                                                                                     |
|:----------------|:-------------------------------------------|:--------------------------------------------------------------------------------------------|
| `play-dir`      | `<play-dir>/whatsnew-<locale>`             | [r0adkll/upload-google-play](https://github.com/r0adkll/upload-google-play) `whatsNewDirectory` |
| `play-gpp-dir`  | `<play-gpp-dir>/<locale>/default.txt`      | [Gradle Play Publisher](https://github.com/Triple-T/gradle-play-publisher), e.g. `app/src/main/play/release-notes` |
| `appstore-file` | the given path                             | fastlane `release_notes.txt` or the App Store Connect API                                   |

Relative paths are resolved from the workspace and parent directories are created. Files are written as
UTF-8 without a trailing newline, so their size matches the counted text. Every locale gets the same text;
translation is out of scope, so list only locales whose users should see the source language, or translate the
files in a later step.

**API usage**

The token needs `issues: read` and `pull-requests: read` (plus `contents: read` for `from-tag`); the default
`github.token` works when the job grants them.

- Milestone source: 1 call per 100 milestones to resolve the title, then 1 call per 100 closed issues in the
  milestone.
- Tag source: 1 call per 100 commits for the compare, then 1 call **per commit** to find its pull requests,
  because GitHub has no bulk endpoint for this. A range of 300 commits costs about 303 calls. Collection stops
  as soon as `max-prs` (default 200) merged pull requests are found, and a warning says later changes were
  skipped. For big ranges prefer the milestone source.

### Inputs 📥

| name                | description                                                                                                   | required | default                                      |
|:--------------------|:--------------------------------------------------------------------------------------------------------------|:---------|:---------------------------------------------|
| milestone           | Milestone title or number. Titles are matched first (exactly, then ignoring case), then numbers.             | No*      | ❌                                           |
| from-tag            | Tag, branch or SHA to compare from.                                                                           | No*      | ❌                                           |
| to-ref              | Tag, branch or SHA to compare to. Only used with `from-tag`.                                                  | No       | `GITHUB_SHA`                                 |
| max-prs             | Maximum number of merged pull requests to collect.                                                            | No       | `200`                                        |
| include-labels      | Comma-separated labels; when set, only pull requests with one of them are used.                               | No       | ❌                                           |
| exclude-labels      | Comma-separated labels; pull requests with any of them are skipped.                                           | No       | `skip-release-notes,internal,dependencies`   |
| sections            | Comma-separated `label:Title` pairs in priority order.                                                        | No       | ❌                                           |
| other-section-title | Title for pull requests without a mapped label.                                                               | No       | `Other changes`                              |
| include-unlabeled   | Set to `false` to drop pull requests without a mapped label.                                                  | No       | `true`                                       |
| clean-titles        | Strip ticket and conventional-commit prefixes.                                                                | No       | `true`                                       |
| header              | Optional first line; `{version}` is replaced with `version`.                                                  | No       | ❌                                           |
| version             | Value for `{version}` in `header`, e.g. the `version` output of milestone-version-increment.                  | No       | ❌                                           |
| locales             | Comma-separated locales for the Play files.                                                                   | No       | `en-US`                                      |
| play-dir            | Directory for `whatsnew-<locale>` files.                                                                      | No       | ❌                                           |
| play-gpp-dir        | Directory for `<locale>/default.txt` files.                                                                   | No       | ❌                                           |
| appstore-file       | Path for the App Store text.                                                                                  | No       | ❌                                           |
| github-token        | Token used to read milestones, issues, commits and pull requests.                                             | No       | `github.token`                               |
| repository          | Repository in `owner/name` form.                                                                              | No       | current repository                           |

\* Exactly one of `milestone` or `from-tag` is required.

### Outputs 📤

1. **play-notes** :- The Google Play text, at most 500 characters.
2. **appstore-notes** :- The App Store text, at most 4000 characters.
3. **markdown** :- The full list with section headings, pull request links and authors, never truncated. Use it for a GitHub release body or a `#releases` message. It is also written to the job summary.
4. **pr-count** :- Number of pull requests in the notes after label filtering, before store truncation.
5. **truncated** :- `true` when the Play or App Store text was shortened, otherwise `false`.

Multi-line outputs are written with a random heredoc delimiter. Pass them to scripts through `env:` rather
than inlining `${{ }}` in `run:`.

When nothing matches, the step still succeeds with a warning, writes the files with only the header, and
`markdown` says no pull requests matched.

### GitHub API assumptions 🔌

These are based on the GitHub REST API documentation (`X-GitHub-Api-Version: 2022-11-28`) and are covered by
recorded responses in the tests, not by calls to the real API:

- `GET /repos/{owner}/{repo}/milestones?state=all` lists open and closed milestones.
- `GET /repos/{owner}/{repo}/issues?milestone=N&state=closed` returns pull requests as issues with a
  `pull_request.merged_at` field; `null` means closed without merging.
- `GET /repos/{owner}/{repo}/compare/{base}...{head}` supports `per_page`/`page` pagination through the `Link`
  header and returns commits oldest first.
- `GET /repos/{owner}/{repo}/commits/{sha}/pulls` returns the pull requests a commit belongs to, including open
  ones, which are skipped. For squash and rebase merges this relies on GitHub's association between the new
  commit and the pull request.
- Pagination follows `rel="next"` links only on the API host, so the token is never sent elsewhere.
  `GITHUB_API_URL` is respected for GitHub Enterprise Server.

## Examples 🧪

Ready-to-copy workflows live in [`examples/`](examples):

- [`release-notes-from-milestone.yml`](examples/release-notes-from-milestone.yml) uses `milestone-version-increment` to find the release milestone, writes Play `whatsnew-*` files from its pull requests and uploads the bundle for `com.example.app` with `r0adkll/upload-google-play`. It needs a `PLAY_SERVICE_ACCOUNT_JSON` secret and an already configured release signing setup.
- [`release-notes-between-tags.yml`](examples/release-notes-between-tags.yml) runs when a `vX.Y.Z` tag is pushed, builds notes from the previous tag, writes the fastlane App Store file and creates the GitHub release with the `markdown` output as its body.

Copy one into `.github/workflows/` of your repository.

## Development 🛠️

```bash
npm test
```

The action has no npm dependencies; it uses only Node 24 built-ins. The tests use `node:test`, stub `fetch`
with recorded GitHub REST responses and write files to temporary directories.

| Workflow | Trigger | What it does |
|:---------|:--------|:-------------|
| [CI](.github/workflows/ci.yml) | push to `main`, pull requests | Syntax check of every source file, actionlint, unit tests on Node 24, and an integration run of the action against this repository from the previous tag (or the first commit), checking that every file is written and the outputs are valid even when no pull requests match. |
| [Release](.github/workflows/release.yml) | manual (`patch` / `minor` / `major`) | Runs CI, calculates the next version from the highest `vX.Y.Z` tag, publishes a GitHub release with generated notes, and moves the `vMAJOR` tag. |

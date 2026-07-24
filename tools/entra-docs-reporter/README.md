# Entra Docs Daily Reporter (GitHub Actions)

This example publishes a **daily report at 06:00 UTC** with Entra documentation updates in a strict **last 24 hours** window (times shown in the report use the `TZ` env var, default `Europe/Amsterdam`).

It posts a grouped Markdown report to a GitHub issue so GitHub notifications can deliver the email.

## What this includes

- GitHub Actions workflow: `.github/workflows/entra-docs-daily-reporter.yml`
- Reporter script: `tools/entra-docs-reporter/report.mjs`
- Node package: `tools/entra-docs-reporter/package.json`

## How it works

1. Workflow triggers once a day at 06:00 UTC (plus `workflow_dispatch` for manual runs). The report window is an exact, non-overlapping calendar day in the `TZ` timezone (midnight to midnight), computed from the run date rather than "now minus 24h" - so a late-firing scheduled run or a manual re-run the same day always reproduces the same window and never duplicates content already reported.
2. Script scans **Auto Publish batch commits** on each repo listed in `PUBLISH_SOURCES` (see `report.mjs`) - by default `MicrosoftDocs/entra-docs` in full, plus `MicrosoftDocs/azure-docs` scoped to `articles/active-directory-b2c/` (Entra External ID / B2C content that hasn't been migrated into entra-docs yet).
   Auto Publish batches are the `"Auto Publish – main to live"` and `"Merging changes synced"` merge commits created by `learn-build-service-prod[bot]`. They batch all content that was merged to `main` since the previous publish and represent the moment docs become live on learn.microsoft.com.
3. Script queries batch commits directly within the window (`since`/`until`) and expands each one into one row per publishable `.md` file it contains.
4. Results are grouped by the top-level folder under `docs/` or `articles/` (e.g. `identity`, `external-id`, `global-secure-access`, `active-directory-b2c`).
5. For each file, an MS Learn URL and a GitHub source link are generated.
6. Workflow creates or updates a daily issue with the report body.
7. If the daily issue already exists, the workflow adds a refresh comment with the latest report content so GitHub still sends an email notification with a non-empty body.
8. GitHub sends notifications to subscribed users/watchers.
9. HTML, Markdown, and metadata outputs are uploaded as artifacts.

## Why Auto Publish commits instead of author commits?

The `MicrosoftDocs/entra-docs` repository has two kinds of commits on `main`:

| Commit type | Creator | Meaning |
|---|---|---|
| Author commit | Human author / Copilot | Content was written and merged to the working branch |
| Auto Publish merge | `learn-build-service-prod[bot]` | Content **became live** on learn.microsoft.com |

GitHub's path-filtered commits API silently excludes merge commits. The old approach (querying per subpage path) therefore missed any day where only Auto Publish batches ran — producing empty reports even when real content shipped. Tracking Auto Publish batches directly solves this: the report always reflects what readers can actually see on learn.microsoft.com today.

## Sources scanned (default)

- `MicrosoftDocs/entra-docs` — Auto Publish batch commits within the last 24 hours (all publishable docs)
- `MicrosoftDocs/azure-docs` — Auto Publish batch commits within the last 24 hours, scoped to `articles/active-directory-b2c/` only. azure-docs covers all of Azure, so it's kept narrow; a batch commit still has its full file list fetched to check for matches, so adding more `pathPrefixes` there increases API calls proportional to how many batches land on that repo per day, not to how narrow the prefix is.

## Required GitHub setup

No custom SMTP secrets are required.

Make sure these are enabled so mail is delivered by GitHub notifications:

- You are watching the repository (see below - this is what actually matters, not per-issue subscribe)
- Notification email is enabled in GitHub account settings
- The workflow has issue write permission (already configured)

## How to make it email you daily

This workflow creates a **new issue every day**, so subscribing to a single issue (clicking "Subscribe" on it) only ever covers that one day - it does nothing for tomorrow's issue. What actually delivers a recurring daily email is your **repository-level Watch setting**, not per-issue subscriptions:

1. If you own this repo (forked it into your own account), you're already covered - GitHub automatically watches repos you own. No action needed.
2. If it's someone else's repo, click **Watch** at the top of the repo page -> **Custom** -> check **Issues** -> **Apply**. This scopes notifications to just issues (i.e. the daily reports), skipping any PR/release/discussion noise the repo might pick up later. **All Activity** also works but is broader than needed.
3. Run workflow_dispatch once to confirm you get the first email.
4. To stop the emails later, use the same **Watch** dropdown -> **Ignore**. GitHub's REST API only exposes a coarse `subscribed`/`ignored` toggle for this (and repo owners can't fully unwatch their own repo through it - a `PUT .../subscription` with `subscribed: false` silently no-ops), so the granular "Custom" watch types are only configurable from the web UI.

If you want a mailbox rule for the report, filter on issue title prefix: Daily Entra Docs PR Report.

## Customize tracking

- `LOOKBACK_HOURS`: default `24`
- `TZ`: timezone for the report window, timestamps, and issue titles - default `Europe/Amsterdam`, set in the workflow's `env:` block
- `PUBLISH_SOURCES` in `report.mjs`: which repos (and optionally which folders within them) get scanned

## Local test

From repo root:

```powershell
cd tools/entra-docs-reporter
npm install
$env:GITHUB_TOKEN = "<your_token>"
npm run report
```

## Publish this example

If you want to share this publicly so others can copy it, publish these files:

- `.github/workflows/entra-docs-daily-reporter.yml`
- `tools/entra-docs-reporter/package.json`
- `tools/entra-docs-reporter/report.mjs`
- `tools/entra-docs-reporter/README.md`

Then include this quick-start snippet in your blog or docs:

```text
Copy the workflow + script into your own repo (you'll automatically be watching it) and run workflow_dispatch once. GitHub notifications will then email daily report updates once a day.
```

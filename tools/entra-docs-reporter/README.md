# Entra Docs Daily Reporter (GitHub Actions)

This example publishes a **daily report at 07:00 Europe/Amsterdam** with Entra documentation updates in a strict **last 24 hours** window.

It posts a grouped Markdown report to a GitHub issue so GitHub notifications can deliver the email.

## What this includes

- GitHub Actions workflow: `.github/workflows/entra-docs-daily-reporter.yml`
- Reporter script: `tools/entra-docs-reporter/report.mjs`
- Node package: `tools/entra-docs-reporter/package.json`

## How it works

1. Workflow triggers hourly and only runs at 07:00 local Europe/Amsterdam time.
2. Script scans **Auto Publish batch commits** on `MicrosoftDocs/entra-docs`.
   These are the `"Auto Publish – main to live"` and `"Merging changes synced"` merge commits created by `learn-build-service-prod[bot]` roughly every 5 hours. They batch all content that was merged to `main` since the previous publish and represent the moment docs become live on learn.microsoft.com.
3. Script filters batch commits to the last 24 hours and expands each commit into one row per publishable `.md` file it contains.
4. Results are grouped by the top-level folder under `docs/` (e.g. `identity`, `external-id`, `global-secure-access`).
5. For each file, an MS Learn URL and a GitHub source link are generated.
6. Workflow creates or updates a daily issue with the report body.
7. GitHub sends notifications to subscribed users/watchers.
8. HTML, Markdown, and metadata outputs are uploaded as artifacts.

## Why Auto Publish commits instead of author commits?

The `MicrosoftDocs/entra-docs` repository has two kinds of commits on `main`:

| Commit type | Creator | Meaning |
|---|---|---|
| Author commit | Human author / Copilot | Content was written and merged to the working branch |
| Auto Publish merge | `learn-build-service-prod[bot]` | Content **became live** on learn.microsoft.com |

GitHub's path-filtered commits API silently excludes merge commits. The old approach (querying per subpage path) therefore missed any day where only Auto Publish batches ran — producing empty reports even when real content shipped. Tracking Auto Publish batches directly solves this: the report always reflects what readers can actually see on learn.microsoft.com today.

## Sources scanned (default)

- `MicrosoftDocs/entra-docs` — Auto Publish batch commits within the last 24 hours

## Required GitHub setup

No custom SMTP secrets are required.

Make sure these are enabled so mail is delivered by GitHub notifications:

- You are watching the repository (or at least subscribed to report issues)
- Notification email is enabled in GitHub account settings
- The workflow has issue write permission (already configured)

## How to make it email you daily

GitHub sends issue notifications to subscribers/watchers. To ensure you get this report in email:

1. Set watch level to custom and include issues for this repository.
2. Run workflow_dispatch once.
3. Open the created report issue and click Subscribe if needed.
4. You will receive future daily report updates by email from GitHub notifications.

If you want a mailbox rule for info@janbakker.tech, filter on issue title prefix: Daily Entra Docs PR Report.

## Customize tracking

- `LOOKBACK_HOURS`: default `24`

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
Copy the workflow + script, run workflow_dispatch once, and subscribe to the generated issue. GitHub notifications will then email daily report updates at 07:00 Europe/Amsterdam.
```

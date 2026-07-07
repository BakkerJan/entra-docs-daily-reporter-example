# Entra Docs Daily Reporter (GitHub Actions)

This example publishes a **daily report at 07:00 Europe/Amsterdam** with all newly opened pull requests related to Microsoft Entra documentation.

It produces grouped HTML tables by subcategory (for example: Conditional Access, Authentication, Identity Governance), then posts the report to a GitHub issue so GitHub notifications can deliver the email.

## What this includes

- GitHub Actions workflow: `.github/workflows/entra-docs-daily-reporter.yml`
- Reporter script: `tools/entra-docs-reporter/report.mjs`
- Node package: `tools/entra-docs-reporter/package.json`

## How it works

1. Workflow triggers hourly and only runs at 07:00 local Europe/Amsterdam time.
2. Script looks back 24 hours for new PRs in configured documentation repos.
3. Script filters for Entra-related PRs.
4. PRs are grouped into subcategories.
5. Workflow creates or updates a daily issue with the report body.
6. GitHub sends notifications to subscribed users/watchers.
7. HTML, Markdown, and metadata outputs are uploaded as artifacts.

## Repositories scanned (default)

- `MicrosoftDocs/entra-docs`
- `MicrosoftDocs/azure-docs` (filtered by Entra keywords)

Override using env `ENTRA_DOC_REPOS` in the workflow.

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

## Customize subcategories

The grouping rules are in `report.mjs` inside `detectSubcategory(...)`.

You can add or adjust pattern rules, for example:

- `Conditional Access`
- `Authentication`
- `Identity Governance`
- `External Identities`
- `Identity Protection`
- `Permissions Management`
- `Workload Identities`
- `Verified ID`

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

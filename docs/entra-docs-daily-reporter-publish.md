# Copy/Paste Example: Daily Entra Documentation PR Reporter

Use this example to track Microsoft Entra documentation updates and receive a daily notification-friendly summary.

Delivery model: the workflow posts a daily GitHub issue with Markdown tables. GitHub issue notifications provide the email delivery.

## Features

- Runs on GitHub Actions
- Daily schedule at 07:00 (Europe/Amsterdam)
- Strict 24-hour reporting window
- Grouped Markdown tables per Entra subcategory/subpage
- Artifact upload with the rendered HTML report
- Commit-based tracking for Auto Publish batches on MicrosoftDocs/entra-docs
- Easy to customize subpages and grouping logic

## Files

- `.github/workflows/entra-docs-daily-reporter.yml`
- `tools/entra-docs-reporter/report.mjs`
- `tools/entra-docs-reporter/package.json`
- `tools/entra-docs-reporter/README.md`

## Setup (2 minutes)

1. Copy the files into your repository.
2. Ensure the workflow can write issues (already configured in permissions).
3. Run the workflow manually once with **workflow_dispatch**.
4. Subscribe to the created report issue or watch the repository for issues.
5. Validate email notification and HTML table formatting.

## Suggested blog section

### Daily Microsoft Entra Docs PR Reporter

I use a GitHub Actions workflow that runs daily at 07:00 and emails me all newly opened Entra-related docs pull requests.

What I like:

- It catches updates from `MicrosoftDocs/entra-docs` and Azure Docs commits under `articles/active-directory/<subpage>`.
- The report is grouped by subcategory, so I can scan changes quickly.
- The email-friendly Markdown table includes direct links to commits/PRs.

How to adopt:

- Copy workflow and Node script
- Enable issue notifications in GitHub
- Adjust active-directory subpages and tracking settings
- Optionally tweak subcategory rules in `detectSubcategory(...)`

This makes docs change tracking fully automated and easy to share with teams.

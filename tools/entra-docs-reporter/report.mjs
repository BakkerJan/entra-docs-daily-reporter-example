import fs from "node:fs/promises";
import path from "node:path";

const GITHUB_API = "https://api.github.com";

function getEnv(name, fallback = "") {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function splitCsv(input) {
  return input
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escMd(value) {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function titleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toAmsterdamTime(iso) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return formatter.format(new Date(iso)).replace(",", "");
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "entra-docs-daily-reporter"
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API error ${response.status} for ${url}: ${details}`);
  }

  return response.json();
}

async function listPullRequests(repo, token, sinceIso) {
  const items = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${perPage}&page=${page}`;
    const pulls = await fetchJson(url, token);
    if (!Array.isArray(pulls) || pulls.length === 0) {
      break;
    }

    let reachedOlder = false;

    for (const pr of pulls) {
      if (new Date(pr.created_at) < new Date(sinceIso)) {
        reachedOlder = true;
        break;
      }
      items.push(pr);
    }

    if (reachedOlder || pulls.length < perPage) {
      break;
    }

    page += 1;
  }

  return items;
}

async function listPullFiles(repo, number, token) {
  const files = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`;
    const pageItems = await fetchJson(url, token);

    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }

    files.push(...pageItems.map((f) => f.filename));

    if (pageItems.length < perPage) {
      break;
    }

    page += 1;
  }

  return files;
}

async function listCommitsByPath(repo, docsPath, token, sinceIso) {
  const items = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/commits?path=${encodeURIComponent(docsPath)}&per_page=${perPage}&page=${page}`;
    const commits = await fetchJson(url, token);

    if (!Array.isArray(commits) || commits.length === 0) {
      break;
    }

    let reachedOlder = false;

    for (const c of commits) {
      const createdAt = c.commit?.author?.date || c.commit?.committer?.date;
      if (!createdAt) {
        continue;
      }
      if (new Date(createdAt) < new Date(sinceIso)) {
        reachedOlder = true;
        break;
      }
      items.push(c);
    }

    if (reachedOlder || commits.length < perPage) {
      break;
    }

    page += 1;
  }

  return items;
}

async function listCommitsForSubpages(repo, basePath, subpages, token, sinceIso) {
  const rows = [];

  for (const subpage of subpages) {
    const pathForCall = `${basePath.replace(/\/+$/, "")}/${subpage.replace(/^\/+/, "")}`;
    const commits = await listCommitsByPath(repo, pathForCall, token, sinceIso);

    for (const commit of commits) {
      const createdAt = commit.commit?.author?.date || commit.commit?.committer?.date;
      if (!createdAt) {
        continue;
      }

      const message = (commit.commit?.message || "").split(/\r?\n/)[0] || `Commit ${commit.sha.slice(0, 7)}`;
      const author = commit.author?.login || commit.commit?.author?.name || "unknown";

      rows.push({
        subcategory: titleCase(subpage),
        number: commit.sha.slice(0, 7),
        title: message,
        repo,
        author,
        createdAt,
        labels: ["commit"],
        url: commit.html_url
      });
    }
  }

  return rows;
}

async function getCommitDetails(repo, sha, token) {
  const url = `${GITHUB_API}/repos/${repo}/commits/${sha}`;
  return fetchJson(url, token);
}

function extractSubpagesFromFiles(files, docsPath) {
  const normalized = docsPath.replace(/^\/+|\/+$/g, "");
  const prefixes = [
    `${normalized}/`,
    `${normalized.replace(/^articles\//, "")}/`
  ];

  const subpages = new Set();
  for (const f of files) {
    const filename = (f.filename || "").toLowerCase();
    for (const prefix of prefixes) {
      const p = prefix.toLowerCase();
      if (!filename.startsWith(p)) {
        continue;
      }

      const rest = filename.slice(p.length);
      const segment = rest.split("/").filter(Boolean)[0];
      if (segment) {
        subpages.add(titleCase(segment));
      } else {
        subpages.add("General");
      }
      break;
    }
  }

  return Array.from(subpages);
}

function detectSubcategory(repo, pr, filePaths) {
  const labels = (pr.labels || []).map((l) => l.name.toLowerCase());
  const haystack = `${pr.title} ${(pr.body || "")}`.toLowerCase();
  const files = filePaths.map((f) => f.toLowerCase());

  const rules = [
    { name: "Conditional Access", patterns: [/conditional[- ]?access/, /\/conditional-access\//] },
    { name: "Authentication", patterns: [/authentication/, /\/authentication\//] },
    { name: "Identity Governance", patterns: [/identity[- ]?governance/, /\/identity-governance\//] },
    { name: "External Identities", patterns: [/external[- ]?identit/, /\/external-identities\//] },
    { name: "Identity Protection", patterns: [/identity[- ]?protection/, /\/identity-protection\//] },
    { name: "Permissions Management", patterns: [/permissions[- ]?management/, /\/permissions-management\//] },
    { name: "Workload Identities", patterns: [/workload[- ]?identit/, /\/workload-identities\//] },
    { name: "Verified ID", patterns: [/verified id/, /\/verified-id\//] }
  ];

  for (const rule of rules) {
    const hit = rule.patterns.some((p) => {
      if (p.test(haystack)) return true;
      if (labels.some((l) => p.test(l))) return true;
      return files.some((f) => p.test(f));
    });

    if (hit) return rule.name;
  }

  for (const fullPath of files) {
    const segments = fullPath.split("/").filter(Boolean);
    if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
      if (segments[0] === "docs" && segments[1]) return titleCase(segments[1]);
      if (segments[0]) return titleCase(segments[0]);
    }
    if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
      const idx = segments.indexOf("articles");
      if (idx >= 0 && segments[idx + 1]) {
        return titleCase(segments[idx + 1]);
      }
    }
  }

  return "General";
}

function isEntraRelated(repo, pr, filePaths, keywords, azureDocsPathPrefixes) {
  if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
    return true;
  }

  if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
    const lowerFiles = filePaths.map((f) => f.toLowerCase());
    const pathMatch = lowerFiles.some((filePath) =>
      azureDocsPathPrefixes.some((prefix) => filePath.startsWith(prefix.toLowerCase()))
    );
    if (pathMatch) {
      return true;
    }
  }

  const labels = (pr.labels || []).map((l) => l.name.toLowerCase());
  const combined = `${pr.title} ${(pr.body || "")} ${labels.join(" ")} ${filePaths.join(" ")}`.toLowerCase();

  return keywords.some((keyword) => combined.includes(keyword.toLowerCase()));
}

function buildHtml({ generatedAtIso, sinceIso, grouped, total }) {
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const trs = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((row) => {
          const labels = row.labels.length ? row.labels.join(", ") : "-";
          return `
            <tr>
              <td><a href="${esc(row.url)}">#${row.number}</a></td>
              <td>${esc(row.title)}</td>
              <td>${esc(row.repo)}</td>
              <td>${esc(row.author)}</td>
              <td>${esc(toAmsterdamTime(row.createdAt))}</td>
              <td>${esc(labels)}</td>
            </tr>`;
        })
        .join("\n");

      return `
        <h2>${esc(subcategory)} (${rows.length})</h2>
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <th>Title</th>
              <th>Repository</th>
              <th>Author</th>
              <th>Created (Europe/Amsterdam)</th>
              <th>Labels</th>
            </tr>
          </thead>
          <tbody>
            ${trs}
          </tbody>
        </table>`;
    })
    .join("\n");

  const body = total === 0
    ? "<p>No new Entra-related documentation pull requests were opened in the last 24 hours.</p>"
    : sections;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      color-scheme: light;
      --ink: #18253a;
      --muted: #526178;
      --line: #d9e1ec;
      --header: #0f355e;
      --accent: #e7f2ff;
      --card: #ffffff;
      --bg: #f4f7fb;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: Segoe UI, Tahoma, sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 10% 20%, #edf6ff 0, var(--bg) 35%, #f8fafc 100%);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(20, 34, 54, 0.08);
      overflow: hidden;
    }
    .top {
      padding: 20px 24px;
      background: linear-gradient(100deg, #0f355e 0%, #0d5f8a 55%, #2d8da1 100%);
      color: white;
    }
    .top h1 {
      margin: 0 0 8px;
      font-size: 22px;
      line-height: 1.2;
    }
    .meta {
      font-size: 13px;
      color: #d8e5f5;
    }
    .content {
      padding: 18px 24px 28px;
    }
    h2 {
      margin: 22px 0 10px;
      color: var(--header);
      font-size: 18px;
      border-left: 4px solid #4e97d8;
      padding-left: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      table-layout: fixed;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      word-wrap: break-word;
    }
    th {
      background: var(--accent);
      color: #10345d;
      font-weight: 700;
    }
    tr:nth-child(even) td {
      background: #fbfdff;
    }
    a {
      color: #0753a1;
      text-decoration: none;
    }
    .foot {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>Daily Entra Documentation PR Report</h1>
      <div class="meta">Window: ${esc(sinceIso)} to ${esc(generatedAtIso)} | Total new PRs: ${total}</div>
    </div>
    <div class="content">
      ${body}
      <p class="foot">Generated automatically by GitHub Actions.</p>
    </div>
  </div>
</body>
</html>`;
}

function buildIssueBody({ generatedAtIso, sinceIso, grouped, total }) {
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const tableRows = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((row) => {
          const labels = row.labels.length ? row.labels.join(", ") : "-";
          const prLabel = `#${row.number}`;
          return `| ${escMd(row.author)} | ${escMd(toAmsterdamTime(row.createdAt))} | ${escMd(prLabel)} | ${escMd(row.repo)} | ${escMd(row.title)} | ${escMd(row.url)} | ${escMd(labels)} |`;
        })
        .join("\n");

      return `
## ${esc(subcategory)} (${rows.length})

| Author | Created (Europe/Amsterdam) | PR | Repository | Title | URL | Labels |
|---|---|---|---|---|---|---|
${tableRows}`;
    })
    .join("\n\n");

  if (total === 0) {
    return [
      "# Daily Entra Documentation PR Report",
      "",
      `Window: ${sinceIso} to ${generatedAtIso}`,
      "",
      "No new Entra-related documentation pull requests were opened in the last 24 hours.",
      "",
      "Generated automatically by GitHub Actions."
    ].join("\n");
  }

  return [
    "# Daily Entra Documentation PR Report",
    "",
    `Window: ${sinceIso} to ${generatedAtIso}`,
    `Total new PRs: ${total}`,
    "",
    sections,
    "",
    "Generated automatically by GitHub Actions."
  ].join("\n");
}

async function main() {
  const githubToken = getEnv("GITHUB_TOKEN");
  if (!githubToken) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();

  const lookbackHours = Number.parseInt(getEnv("LOOKBACK_HOURS", "24"), 10);
  const since = new Date(generatedAt.getTime() - lookbackHours * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const repos = splitCsv(getEnv("ENTRA_DOC_REPOS", "MicrosoftDocs/entra-docs,MicrosoftDocs/azure-docs"));
  const keywords = splitCsv(
    getEnv(
      "ENTRA_KEYWORDS",
      "entra,active-directory,identity,authentication,conditional-access,external-identities,identity-governance,permissions-management,workload-identities"
    )
  );
  const azureDocsPathPrefixes = splitCsv(
    getEnv("AZURE_DOCS_PATH_PREFIXES", "articles/active-directory")
  );
  const azureDocsCommitsPath = getEnv("AZURE_DOCS_COMMITS_PATH", "articles/active-directory");
  const useCommitFeedForAzureDocs = getEnv("USE_COMMITS_FOR_AZURE_DOCS", "true").toLowerCase() === "true";
  const azureDocsSubpages = splitCsv(
    getEnv(
      "AZURE_DOCS_SUBPAGES",
      "app-provisioning,app-proxy,authentication,azuread-dev,cloud-infrastructure-entitlement-management,cloud-sync,conditional-access,develop,devices,enterprise-users,external-identities,fundamentals,governance,hybrid,identity-protection,manage-apps,managed-identities-azure-resources,roles,saas-apps,verify"
    )
  );

  const allRows = [];

  for (const repo of repos) {
    if (repo.toLowerCase() === "microsoftdocs/azure-docs" && useCommitFeedForAzureDocs) {
      const commitRows = await listCommitsForSubpages(
        repo,
        azureDocsCommitsPath,
        azureDocsSubpages,
        githubToken,
        sinceIso
      );
      allRows.push(...commitRows);
      continue;
    }

    const prs = await listPullRequests(repo, githubToken, sinceIso);
    for (const pr of prs) {
      const files = await listPullFiles(repo, pr.number, githubToken);
      if (!isEntraRelated(repo, pr, files, keywords, azureDocsPathPrefixes)) {
        continue;
      }

      allRows.push({
        subcategory: detectSubcategory(repo, pr, files),
        number: pr.number,
        title: pr.title,
        repo,
        author: pr.user?.login || "unknown",
        createdAt: pr.created_at,
        labels: (pr.labels || []).map((l) => l.name),
        url: pr.html_url
      });
    }
  }

  const uniqueRows = Array.from(
    new Map(allRows.map((row) => [`${row.repo}#${row.number}`, row])).values()
  );

  const grouped = uniqueRows.reduce((acc, row) => {
    acc[row.subcategory] ??= [];
    acc[row.subcategory].push(row);
    return acc;
  }, {});

  const html = buildHtml({
    generatedAtIso,
    sinceIso,
    grouped,
    total: uniqueRows.length
  });
  const issueBody = buildIssueBody({
    generatedAtIso,
    sinceIso,
    grouped,
    total: uniqueRows.length
  });

  const htmlOutputPath = getEnv("REPORT_OUTPUT", "report-output/entra-daily-report.html");
  const issueOutputPath = getEnv("ISSUE_OUTPUT", "report-output/entra-daily-report.md");
  await fs.mkdir(path.dirname(htmlOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(issueOutputPath), { recursive: true });
  await fs.writeFile(htmlOutputPath, html, "utf8");
  await fs.writeFile(issueOutputPath, issueBody, "utf8");

  const dateLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(generatedAt);

  const metadata = {
    title: `Daily Entra Docs PR Report - ${dateLabel}`,
    label: getEnv("ISSUE_LABEL", "entra-docs-report"),
    total: uniqueRows.length,
    generatedAtIso,
    sinceIso
  };

  const metadataOutputPath = getEnv("REPORT_METADATA_OUTPUT", "report-output/entra-daily-report.json");
  await fs.mkdir(path.dirname(metadataOutputPath), { recursive: true });
  await fs.writeFile(metadataOutputPath, JSON.stringify(metadata, null, 2), "utf8");

  console.log(`Report created. New PR count: ${uniqueRows.length}`);
  console.log(`Saved HTML report to ${htmlOutputPath}`);
  console.log(`Saved issue body to ${issueOutputPath}`);
  console.log(`Saved report metadata to ${metadataOutputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

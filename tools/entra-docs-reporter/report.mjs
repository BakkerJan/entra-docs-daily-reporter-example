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

function mdLink(label, url) {
  if (!url || !String(url).trim()) {
    return "-";
  }
  return `[${label}](${url})`;
}

function normalizeDocPath(filePath) {
  let path = filePath.replace(/\\/g, "/").replace(/\.md$/i, "");
  if (path.endsWith("/index")) {
    path = path.slice(0, -6);
  }
  return path;
}

// Non-publishable top-level folders under docs/ in MicrosoftDocs/entra-docs
const ENTRA_DOCS_NON_PUBLISH_FOLDERS = new Set([
  "breadcrumb",
  "backup",
  "includes",
  "media",
  "standards",
  "architecture",
]);

function isLikelyLearnPagePath(repo, filePath) {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (!p.endsWith(".md")) {
    return false;
  }
  if (p.endsWith("/toc.md") || p.endsWith("/toc.yml") || p.endsWith("/index.yml")) {
    return false;
  }

  if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
    if (!p.startsWith("articles/")) return false;
    if (p.includes("/includes/")) return false;
    if (p.includes("/media/")) return false;
    return true;
  }

  if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
    if (!p.startsWith("docs/")) return false;
    const topFolder = p.slice("docs/".length).split("/")[0];
    if (ENTRA_DOCS_NON_PUBLISH_FOLDERS.has(topFolder)) return false;
    return true;
  }

  return true;
}

function toMsLearnUrl(repo, filePath) {
  const normalized = normalizeDocPath(filePath);
  const lowerNorm = normalized.toLowerCase();
  
  if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
    if (lowerNorm.startsWith("articles/")) {
      return `https://learn.microsoft.com/en-us/azure/${normalized.slice("articles/".length)}`;
    }
    const idx = lowerNorm.indexOf("articles/");
    if (idx >= 0) {
      return `https://learn.microsoft.com/en-us/azure/${normalized.slice(idx + "articles/".length)}`;
    }
  }
  
  if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
    if (lowerNorm.startsWith("docs/")) {
      return `https://learn.microsoft.com/en-us/entra/${normalized.slice("docs/".length)}`;
    }
    const idx = lowerNorm.indexOf("docs/");
    if (idx >= 0) {
      return `https://learn.microsoft.com/en-us/entra/${normalized.slice(idx + "docs/".length)}`;
    }
  }
  
  return "";
}

function toGithubSourceUrl(repo, filePath) {
  if (!filePath) return "";
  const normalizedPath = filePath.replace(/\\/g, "/");
  const repoLower = repo.toLowerCase();
  if (repoLower === "microsoftdocs/entra-docs") {
    return `https://github.com/MicrosoftDocs/entra-docs/blob/main/${normalizedPath}`;
  }
  if (repoLower === "microsoftdocs/azure-docs") {
    return `https://github.com/MicrosoftDocs/azure-docs/blob/main/${normalizedPath}`;
  }
  return `https://github.com/${repo}/blob/main/${normalizedPath}`;
}

function pickPrimaryDocFile(repo, filePaths) {
  const publishableFiles = filePaths.filter((f) => isLikelyLearnPagePath(repo, f));
  if (publishableFiles.length > 0) {
    if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
      const preferred = publishableFiles.find((f) => f.toLowerCase().startsWith("articles/active-directory/"));
      if (preferred) return preferred;
      return publishableFiles[0];
    }
    if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
      return publishableFiles[0];
    }
  }

  const mdFiles = filePaths.filter((f) => f.toLowerCase().endsWith(".md"));
  const likelyPublishable = mdFiles.filter((f) => {
    const lowerF = f.toLowerCase();
    if (lowerF.endsWith("/toc.md") || lowerF.endsWith("/toc.yml") || lowerF.endsWith("/index.yml")) {
      return false;
    }
    if (!lowerF.includes("articles/") && !lowerF.includes("docs/")) {
      return false;
    }
    return true;
  });
  
  return likelyPublishable.length > 0 ? likelyPublishable[0] : "";
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
  const commitToPrCache = new Map();
  const commitDetailsCache = new Map();

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
      const prUrl = await getAssociatedPullRequestUrl(repo, commit.sha, token, commitToPrCache);
      let details = commitDetailsCache.get(commit.sha);
      if (!details) {
        details = await getCommitDetails(repo, commit.sha, token);
        commitDetailsCache.set(commit.sha, details);
      }
      const filePaths = (details.files || []).map((f) => f.filename).filter(Boolean);
      const primaryDocFile = pickPrimaryDocFile(repo, filePaths);
      const msLearnUrl = primaryDocFile && isLikelyLearnPagePath(repo, primaryDocFile) ? toMsLearnUrl(repo, primaryDocFile) : "";
      const sourceUrl = primaryDocFile ? toGithubSourceUrl(repo, primaryDocFile) : "";

      rows.push({
        subcategory: titleCase(subpage),
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        title: message,
        repo,
        author,
        createdAt,
        labels: ["commit"],
        source: "Commit",
        commitUrl: commit.html_url,
        msLearnUrl,
        sourceUrl,
        prUrl,
        url: commit.html_url
      });
    }
  }

  return rows;
}

async function getAssociatedPullRequestUrl(repo, sha, token, cache) {
  if (cache.has(sha)) {
    return cache.get(sha);
  }

  try {
    const url = `${GITHUB_API}/repos/${repo}/commits/${sha}/pulls?per_page=1`;
    const prs = await fetchJson(url, token);
    const prUrl = Array.isArray(prs) && prs.length > 0 ? prs[0].html_url : "";
    cache.set(sha, prUrl || "");
    return prUrl || "";
  } catch {
    cache.set(sha, "");
    return "";
  }
}

function rowsSince(rows, sinceIso) {
  const since = new Date(sinceIso);
  return rows.filter((r) => new Date(r.createdAt) >= since);
}

function groupRows(rows) {
  return rows.reduce((acc, row) => {
    acc[row.subcategory] ??= [];
    acc[row.subcategory].push(row);
    return acc;
  }, {});
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
    { name: "Conditional Access", patterns: [/conditional[- ]?access/, /\/conditional-access\//i] },
    { name: "Authentication", patterns: [/\bauthentication\b/, /\/authentication\//i] },
    { name: "App Provisioning", patterns: [/app[- ]?provisioning|provisioning|scim/, /\/app-provisioning\//i] },
    { name: "App Proxy", patterns: [/app[- ]?proxy|application[- ]?proxy|kerberos/, /\/app-proxy\//i] },
    { name: "Identity Governance", patterns: [/identity[- ]?governance|access[- ]?review/, /\/identity-governance\//i] },
    { name: "External Identities", patterns: [/external[- ]?identit|b2b|b2c|guest/, /\/external-identities\//i] },
    { name: "Identity Protection", patterns: [/identity[- ]?protection|risk[- ]?detection|risky user/, /\/identity-protection\//i] },
    { name: "Permissions Management", patterns: [/permissions[- ]?management|entitlement[- ]?management|pam|privileged/, /\/permissions-management\//i] },
    { name: "Workload Identities", patterns: [/workload[- ]?identit|managed identity|service principal|spn/, /\/workload-identities\//i] },
    { name: "Verified ID", patterns: [/verified id|verifiable credentials/, /\/verified-id\//i] },
    { name: "Hybrid Identity", patterns: [/hybrid|azure ad connect|connect|sync|pass-through|federation/, /\/hybrid\//i] },
    { name: "Cloud Sync", patterns: [/cloud sync|cloud synchronization|lightweight sync/, /\/cloud-sync\//i] },
    { name: "Devices", patterns: [/\bdevice\b|device management|intune|enrollment|compliance|windows hello/, /\/devices\//i] },
    { name: "Manage Apps", patterns: [/app management|application management|sso|single sign-on|app assignment/, /\/manage-apps\//i] },
    { name: "SaaS Apps", patterns: [/saas|salesforce|slack|github|dropbox|okta|workday|box|zoom/, /\/saas-apps\//i] },
    { name: "Roles", patterns: [/\brole\b|rbac|admin role|custom role|directory role/, /\/roles\//i] },
    { name: "Enterprise Users", patterns: [/enterprise user|bulk operation|bulk user|bulk create/, /\/enterprise-users\//i] },
    { name: "Governance", patterns: [/governance|lifecycle|access package|attestation|review/, /\/governance\//i] },
    { name: "Fundamentals", patterns: [/fundamental|basic|getting started|what is|overview/, /\/fundamentals\//i] },
    { name: "Develop", patterns: [/\bapi\b|sdk|developer|custom app|integration|protocol|oauth|saml|openid|graphql/, /\/develop\//i] },
    { name: "Azure AD Dev", patterns: [/azure ad|microsoft graph|v1\.0|v2\.0|endpoint/, /\/azuread-dev\//i] },
    { name: "CIEM", patterns: [/cloud infrastructure entitlement|ciem|entitlement management|rights management/, /\/cloud-infrastructure-entitlement-management\//i] },
    { name: "Verify", patterns: [/\bverify\b|verification/, /\/verify\//i] }
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
        // For active-directory paths, dig deeper to find the subpage
        if (segments[idx + 1].toLowerCase() === "active-directory" && segments[idx + 2]) {
          return titleCase(segments[idx + 2]);
        }
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
          const sourceLink = row.sourceUrl ? `<a href="${esc(row.sourceUrl)}">source</a>` : "-";
          const learnLink = row.msLearnUrl ? `<a href="${esc(row.msLearnUrl)}">learn</a>` : "-";
          const commitLink = row.commitUrl ? `<a href="${esc(row.commitUrl)}">commit</a>` : "-";
          return `
            <tr>
              <td><a href="${esc(row.url)}">${esc(row.shortSha)}</a></td>
              <td>${esc(row.title)}</td>
              <td>${esc(row.repo)}</td>
              <td>${esc(row.author)}</td>
              <td>${esc(toAmsterdamTime(row.createdAt))}</td>
              <td>${esc(labels)}</td>
              <td>${commitLink}</td>
              <td>${learnLink}</td>
              <td>${sourceLink}</td>
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
              <th>Commit</th>
              <th>Learn</th>
              <th>Source</th>
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

function buildMarkdownWindow({ title, grouped, total, sinceIso, generatedAtIso }) {
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const tableRows = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((row) => {
          const itemLabel = row.shortSha;
          const updateText = `${itemLabel} ${row.title}`;
          const created = `  ${escMd(toAmsterdamTime(row.createdAt))}  `;
          const author = `  ${escMd(row.author)}  `;
          const update = `  ${escMd(updateText)}  `;
          const commit = `  ${mdLink("commit", row.commitUrl)}  `;
          const learn = `  ${mdLink("learn", row.msLearnUrl)}  `;
          const source = `  ${mdLink("source", row.sourceUrl)}  `;
          const pr = `  ${mdLink("pr", row.prUrl)}  `;
          return `|${created}|${author}|${update}|${commit}|${learn}|${source}|${pr}|`;
        })
        .join("\n");

      return `
## ${esc(subcategory)} (${rows.length})

| Created (Europe/Amsterdam) | Author | Update | Commit | Learn | Source | PR |
|---|---|---|---|---|---|---|
${tableRows}`;
    })
    .join("\n\n");

  if (total === 0) {
    return [
      `## ${title}`,
      `Window: ${sinceIso} to ${generatedAtIso}`,
      "No updates in this window."
    ].join("\n\n");
  }

  return [
    `## ${title}`,
    `Window: ${sinceIso} to ${generatedAtIso}`,
    `Total items: ${total}`,
    "",
    sections
  ].join("\n");
}

function buildIssueBody({ generatedAtIso, primarySinceIso, primaryGrouped, primaryTotal }) {
  const primary = buildMarkdownWindow({
    title: "Last 24 Hours",
    grouped: primaryGrouped,
    total: primaryTotal,
    sinceIso: primarySinceIso,
    generatedAtIso
  });

  return [
    "# Daily Entra Documentation PR Report",
    "",
    primary,
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
  const extendedLookbackHours = lookbackHours;
  const primarySince = new Date(generatedAt.getTime() - lookbackHours * 60 * 60 * 1000);
  const extendedSince = new Date(generatedAt.getTime() - extendedLookbackHours * 60 * 60 * 1000);
  const primarySinceIso = primarySince.toISOString();
  const extendedSinceIso = extendedSince.toISOString();

  // Defaults mirror the ENTRA_DOCS_SUBPAGES value in the workflow YAML; update both if adding new folders.
  const entraDocsSubpages = splitCsv(
    getEnv(
      "ENTRA_DOCS_SUBPAGES",
      "agent-id,architecture,backup,breadcrumb,external-id,fundamentals,global-secure-access,id-governance,id-protection,identity-platform,identity,includes,media,permissions-management,security-copilot,standards,verified-id,workload-id"
    )
  );
  const entraDocsCommitsPath = getEnv("ENTRA_DOCS_COMMITS_PATH", "docs");

  const allRows = [];

  const commitRows = await listCommitsForSubpages(
    "MicrosoftDocs/entra-docs",
    entraDocsCommitsPath,
    entraDocsSubpages,
    githubToken,
    extendedSinceIso
  );
  allRows.push(...commitRows);

  const uniqueRows = Array.from(
    new Map(allRows.map((row) => [`${row.repo}#${row.sha}#${row.subcategory}`, row])).values()
  );

  const primaryRows = rowsSince(uniqueRows, primarySinceIso);
  const groupedPrimary = groupRows(primaryRows);
  const groupedExtended = groupRows(uniqueRows);

  const html = buildHtml({
    generatedAtIso,
    sinceIso: primarySinceIso,
    grouped: groupedPrimary,
    total: primaryRows.length
  });
  const issueBody = buildIssueBody({
    generatedAtIso,
    primarySinceIso,
    primaryGrouped: groupedPrimary,
    primaryTotal: primaryRows.length
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
    total24h: primaryRows.length,
    generatedAtIso,
    primarySinceIso
  };

  const metadataOutputPath = getEnv("REPORT_METADATA_OUTPUT", "report-output/entra-daily-report.json");
  await fs.mkdir(path.dirname(metadataOutputPath), { recursive: true });
  await fs.writeFile(metadataOutputPath, JSON.stringify(metadata, null, 2), "utf8");

  console.log(`Report created. 24h items: ${primaryRows.length}`);
  console.log(`Saved HTML report to ${htmlOutputPath}`);
  console.log(`Saved issue body to ${issueOutputPath}`);
  console.log(`Saved report metadata to ${metadataOutputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

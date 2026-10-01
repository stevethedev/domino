// Generates fixtures/mock/*.json in the exact shape Jira REST v3 returns.
// Run: node scripts/gen-mock-fixtures.mjs
// Links are declared once here and written onto BOTH issues (outwardIssue on
// one side, inwardIssue on the other), just like Jira does.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mock");

const LINK_TYPES = {
  Blocks: { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  Relates: { id: "10003", name: "Relates", inward: "relates to", outward: "relates to" },
  Duplicate: { id: "10002", name: "Duplicate", inward: "is duplicated by", outward: "duplicates" },
  Cloners: { id: "10001", name: "Cloners", inward: "is cloned by", outward: "clones" },
};

const CATS = {
  todo: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" },
  prog: { id: 4, key: "indeterminate", name: "In Progress", colorName: "yellow" },
  done: { id: 3, key: "done", name: "Done", colorName: "green" },
};
const STATUS = {
  Backlog: "todo", "To Do": "todo", "In Progress": "prog", "In Review": "prog", Done: "done", Closed: "done",
};

const SITES = {
  acme: "https://acme.atlassian.net",
  partner: "https://partner.atlassian.net",
};

// [key, type, status, summary, assignee|null, points|null, parent?]
const ISSUES = {
  acme: [
    ["CORE-1", "Epic", "In Progress", "Checkout v2", "Dana Whitfield", null],
    ["CORE-7", "Story", "In Progress", "Rate limiter for public API", "Priya Raman", 5],
    ["CORE-8", "Task", "To Do", "Expose rate-limit headers to clients", "Marcus Lee", 2],
    ["CORE-10", "Story", "To Do", "Accept partner payment tokens in checkout", "Dana Whitfield", 8, "CORE-1"],
    ["CORE-11", "Story", "To Do", "Persist tokenized cards on the order", "Priya Raman", 5, "CORE-1"],
    // Sub-task: its parent is a story, so its epic (CORE-1) is found through CORE-11.
    ["CORE-16", "Sub-task", "In Progress", "Migrate card vault schema", "Priya Raman", null, "CORE-11"],
    ["CORE-12", "Task", "Done", "Audit logging for order writes", "Marcus Lee", 3],
    ["CORE-13", "Task", "Backlog", "Retention policy for audit logs", null, 2],
    ["CORE-14", "Bug", "Done", "Cart total rounds half-cents incorrectly", "Sofia Alvarez", 1],
    ["CORE-15", "Bug", "In Review", "Cart total rounding (mobile clone)", "Sofia Alvarez", 1],
    ["CORE-20", "Story", "In Progress", "Shared session store", "Jonas Berg", 5],
    ["CORE-21", "Story", "To Do", "Session handoff between web and partner widget", "Jonas Berg", 3],
    ["WEB-1", "Story", "To Do", "Checkout v2 order confirmation page", "Alex Kim", 3, "CORE-1"],
    ["WEB-2", "Story", "To Do", "Checkout v2 launch toggle", "Alex Kim", 2, "CORE-1"],
    ["WEB-3", "Bug", "To Do", "Safari: promo code field loses focus", null, 1],
    ["WEB-4", "Bug", "Closed", "Promo code input blurs on iOS Safari", "Alex Kim", 1],
    ["WEB-5", "Task", "To Do", "Update checkout copy for accessibility review", "Sofia Alvarez", 1],
    // Lives on acme but outside the default JQL (project OPS) -> ghost by default.
    ["OPS-3", "Task", "In Progress", "Provision PCI-scoped database cluster", "Riley Chen", 8],
  ],
  partner: [
    ["PAY-20", "Epic", "In Progress", "Tokenized payments for Acme", "Noor Haddad", null],
    ["PAY-1", "Story", "Done", "Tokenization service skeleton", "Noor Haddad", 3, "PAY-20"],
    ["PAY-2", "Story", "In Progress", "Token vault with HSM-backed keys", "Tomás Ortega", 8, "PAY-20"],
    ["PAY-3", "Story", "To Do", "Public token exchange endpoint", "Noor Haddad", 5, "PAY-20"],
    // Same key as acme's CORE-7 on purpose: identity must use uid, not key.
    ["CORE-7", "Task", "To Do", "Partner onboarding checklist", "Mei Tanaka", 2],
    ["PAY-4", "Task", "In Progress", "Fraud scoring integration", "Tomás Ortega", 5],
    ["PAY-5", "Task", "Done", "Sandbox credentials for Acme", "Mei Tanaka", 1],
    ["PAY-6", "Task", "To Do", "Rotate sandbox credentials quarterly", null, 1],
    ["PAY-7", "Bug", "To Do", "Webhook retries fire twice", "Tomás Ortega", 2],
    ["PAY-8", "Bug", "In Progress", "Duplicate webhook deliveries", "Mei Tanaka", 2],
    ["PAY-10", "Story", "In Review", "Partner widget reads shared session", "Noor Haddad", 3],
  ],
};

// Native links: [site, linkId, type, outwardKey (source), inwardKey (target)]
// "A blocks B" => outward A, inward B. Link id 10001 is reused on both sites on
// purpose: dedup must key on siteId + linkId.
const LINKS = [
  // 5-deep blocking chain: PAY-1 -> PAY-2 -> PAY-3 =(remote)=> CORE-10 -> CORE-11 -> WEB-1
  ["partner", "10001", "Blocks", "PAY-1", "PAY-2"],
  ["partner", "10002", "Blocks", "PAY-2", "PAY-3"],
  ["acme", "10001", "Blocks", "CORE-10", "CORE-11"],
  ["acme", "10002", "Blocks", "CORE-11", "WEB-1"],
  // WEB-2 has 4 blockers: CORE-11, CORE-8, OPS-3 (ghost), LEG-4 (remote ghost)
  ["acme", "10003", "Blocks", "CORE-11", "WEB-2"],
  ["acme", "10004", "Blocks", "CORE-8", "WEB-2"],
  ["acme", "10005", "Blocks", "OPS-3", "WEB-2"],
  ["acme", "10006", "Blocks", "CORE-7", "CORE-8"],
  // part of the cross-site cycle CORE-20 -> CORE-21 =(remote)=> PAY-10 =(remote)=> CORE-20
  ["acme", "10007", "Blocks", "CORE-20", "CORE-21"],
  ["acme", "10010", "Relates", "CORE-12", "CORE-13"],
  ["acme", "10011", "Cloners", "CORE-15", "CORE-14"],
  ["acme", "10012", "Duplicate", "WEB-3", "WEB-4"],
  ["acme", "10013", "Relates", "WEB-5", "WEB-1"],
  ["partner", "10003", "Relates", "CORE-7", "PAY-4"],
  ["partner", "10004", "Relates", "PAY-5", "PAY-6"],
  ["partner", "10005", "Duplicate", "PAY-7", "PAY-8"],
  // Gives PAY-10 a native blocks link, so issueLinkType-based filters keep it (and the cross-site cycle).
  ["partner", "10006", "Blocks", "PAY-10", "PAY-4"],
];

// Remote links: [site, fromKey, remoteId, relationship, url, title]
const REMOTE = [
  // Cross-site hop of the chain, recorded on BOTH sides (distinct remote ids).
  ["partner", "PAY-3", "20001", "blocks", `${SITES.acme}/browse/CORE-10`, "CORE-10"],
  ["acme", "CORE-10", "30001", "is blocked by", `${SITES.partner}/browse/PAY-3`, "PAY-3"],
  // Not a Jira issue URL: must be ignored.
  ["acme", "CORE-10", "30002", "mentioned in", "https://github.com/acme/web/pull/42", "PR #42"],
  // Cross-site cycle.
  ["acme", "CORE-21", "30003", "blocks", `${SITES.partner}/browse/PAY-10`, "PAY-10"],
  ["partner", "PAY-10", "20002", "blocks", `${SITES.acme}/browse/CORE-20`, "CORE-20"],
  // Configured but disabled site -> ghost.
  ["acme", "WEB-2", "30004", "is blocked by", "https://legacy.atlassian.net/browse/LEG-4", "LEG-4"],
  // Unconfigured Jira site -> ghost labelled with its host.
  ["partner", "PAY-4", "20003", "is blocked by", "https://other.atlassian.net/browse/EXT-9", "EXT-9"],
  // Unknown relationship to a configured site -> "relates to".
  ["partner", "CORE-7", "20004", "discussed with", `${SITES.acme}/browse/CORE-7`, "CORE-7"],
];

// Timeline data, in calendar days relative to the day the fixtures are generated (negative = past).
// start: moved to In Progress; review: moved to In Review; done: resolved; due: Jira due date.
const TIMES = {
  acme: {
    "CORE-1": { start: -26 },
    "CORE-7": { start: -4 },
    "CORE-10": { due: 4 },
    "CORE-12": { start: -32, done: -27 },
    "CORE-14": { start: -14, done: -12 },
    "CORE-15": { start: -6, review: -2 },
    "CORE-16": { start: -2 },
    "CORE-20": { start: -9 },
    "WEB-1": { due: 18 },
    "WEB-2": { due: 21 },
    "WEB-4": { start: -20, done: -18 },
    "OPS-3": { start: -5 },
  },
  partner: {
    "PAY-20": { start: -24 },
    "PAY-1": { start: -24, done: -19 },
    "PAY-2": { start: -17 }, // 8 points, still open: overrunning
    "PAY-3": { due: 6 },
    "PAY-4": { start: -7 },
    "PAY-5": { start: -30, done: -29 },
    "PAY-8": { start: -3 },
    "PAY-10": { start: -8, review: -3 },
  },
};

const GENERATED_ON = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const at = (offsetDays, hour = 15) => new Date(GENERATED_ON.getTime() + offsetDays * 86_400_000 + hour * 3_600_000);
const jiraDateTime = (d) => d.toISOString().replace("Z", "+0000");

const ISSUE_TYPES = {
  Epic: "10000", Story: "10001", Task: "10002", Bug: "10003", "Sub-task": "10004",
};
const HIERARCHY = { Epic: 1, "Sub-task": -1 };

function issueId(site, key) {
  const [proj, n] = key.split("-");
  const base = { acme: 100000, partner: 200000 }[site];
  return String(base + proj.charCodeAt(0) * 100 + Number(n));
}

function statusObj(name) {
  const cat = CATS[STATUS[name]];
  return { name, id: String(1000 + Object.keys(STATUS).indexOf(name)), statusCategory: cat };
}

function issueTypeObj(name) {
  return { id: ISSUE_TYPES[name], name, subtask: name === "Sub-task", hierarchyLevel: HIERARCHY[name] ?? 0 };
}

function linkedIssueRef(site, row) {
  const [key, type, status, summary] = row;
  return {
    id: issueId(site, key),
    key,
    self: `${SITES[site]}/rest/api/3/issue/${issueId(site, key)}`,
    fields: { summary, status: statusObj(status), issuetype: issueTypeObj(type) },
  };
}

function build(site) {
  const rows = new Map(ISSUES[site].map((r) => [r[0], r]));
  const issues = ISSUES[site].map((row) => {
    const [key, type, status, summary, assignee, points, parent] = row;
    return {
      id: issueId(site, key),
      key,
      self: `${SITES[site]}/rest/api/3/issue/${issueId(site, key)}`,
      fields: {
        summary,
        issuetype: issueTypeObj(type),
        status: statusObj(status),
        assignee: assignee
          ? { accountId: `acc-${assignee.toLowerCase().replace(/\W+/g, "-")}`, displayName: assignee, avatarUrls: {} }
          : null,
        customfield_10016: points,
        resolutiondate: TIMES[site][key]?.done !== undefined ? jiraDateTime(at(TIMES[site][key].done)) : null,
        duedate: TIMES[site][key]?.due !== undefined ? at(TIMES[site][key].due).toISOString().slice(0, 10) : null,
        parent: parent ? linkedIssueRef(site, rows.get(parent)) : undefined,
        issuelinks: [],
      },
    };
  });
  const byKey = new Map(issues.map((i) => [i.key, i]));
  for (const [s, id, typeName, outKey, inKey] of LINKS) {
    if (s !== site) continue;
    const type = { ...LINK_TYPES[typeName], self: `${SITES[site]}/rest/api/3/issueLinkType/${LINK_TYPES[typeName].id}` };
    const self = `${SITES[site]}/rest/api/3/issueLink/${id}`;
    // On the source issue, the other end is the outwardIssue.
    byKey.get(outKey).fields.issuelinks.push({ id, self, type, outwardIssue: linkedIssueRef(site, rows.get(inKey)) });
    byKey.get(inKey).fields.issuelinks.push({ id, self, type, inwardIssue: linkedIssueRef(site, rows.get(outKey)) });
  }
  const remoteLinks = {};
  for (const [s, fromKey, rid, relationship, url, title] of REMOTE) {
    if (s !== site) continue;
    const isJira = url.includes(".atlassian.net/browse/");
    (remoteLinks[fromKey] ??= []).push({
      id: Number(rid),
      self: `${SITES[site]}/rest/api/3/issue/${fromKey}/remotelink/${rid}`,
      globalId: isJira ? `appId=mock&issueId=${title}` : `url=${url}`,
      application: isJira ? { type: "com.atlassian.jira", name: "Jira" } : {},
      relationship,
      object: { url, title, icon: {} },
    });
  }
  // Status changelogs, keyed by Jira issue id, in the bulkfetch `changeHistories` shape.
  const statusId = (name) => statusObj(name).id;
  const changelogs = {};
  for (const issue of issues) {
    const t = TIMES[site][issue.key];
    if (!t?.start && t?.start !== 0) continue;
    const histories = [];
    const change = (offset, from, to) =>
      histories.push({
        id: String(histories.length + 1),
        created: jiraDateTime(at(offset, 10)),
        items: [{ field: "status", fieldtype: "jira", fieldId: "status", from: statusId(from), fromString: from, to: statusId(to), toString: to }],
      });
    change(t.start, "To Do", "In Progress");
    if (t.review !== undefined) change(t.review, "In Progress", "In Review");
    if (t.done !== undefined) change(t.done, t.review !== undefined ? "In Review" : "In Progress", issue.fields.status.name);
    changelogs[issue.id] = histories;
  }
  return { issues, remoteLinks, changelogs };
}

const linkTypes = { issueLinkTypes: Object.values(LINK_TYPES) };
// `GET /rest/api/3/status` shape; the same workflow on both mock sites.
const statuses = Object.keys(STATUS).map((name) => ({ ...statusObj(name), statusCategory: CATS[STATUS[name]] }));

for (const site of Object.keys(SITES)) {
  writeFileSync(join(out, `${site}.json`), JSON.stringify({ generatedOn: GENERATED_ON.toISOString().slice(0, 10), ...build(site), statuses }, null, 2) + "\n");
}
writeFileSync(join(out, "linkTypes.json"), JSON.stringify(linkTypes, null, 2) + "\n");
console.log("wrote", Object.keys(SITES).map((s) => `${s}.json`).join(", "), "linkTypes.json");

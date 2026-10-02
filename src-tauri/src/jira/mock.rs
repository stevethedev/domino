//! Phase 1 backend: serves the shared fixtures in fixtures/mock/ and evaluates
//! a tiny JQL subset (kept in sync with src/data/FixtureSource.ts).

use super::{and_filter, is_issue_key, strip_order_by, JiraBackend, JiraResult};
use crate::config::SiteConfig;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const ACME: &str = include_str!("../../../fixtures/mock/acme.json");
const PARTNER: &str = include_str!("../../../fixtures/mock/partner.json");
const LINK_TYPES: &str = include_str!("../../../fixtures/mock/linkTypes.json");

pub(crate) struct MockBackend {
    sites: HashMap<&'static str, Value>,
    link_types: Value,
    fail_sites: HashSet<String>,
}

impl MockBackend {
    /// `fail_sites` simulate outages (set via `DOMINO_MOCK_FAIL_SITES=partner,acme`). Fails only if
    /// the embedded fixtures aren't valid JSON.
    pub(crate) fn new(fail_sites: HashSet<String>) -> serde_json::Result<Self> {
        Ok(Self {
            sites: HashMap::from([("acme", serde_json::from_str(ACME)?), ("partner", serde_json::from_str(PARTNER)?)]),
            link_types: serde_json::from_str(LINK_TYPES)?,
            fail_sites,
        })
    }

    pub(crate) fn from_env() -> serde_json::Result<Self> {
        let fail = std::env::var("DOMINO_MOCK_FAIL_SITES")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect();
        Self::new(fail)
    }

    fn site_data(&self, site: &SiteConfig) -> JiraResult<&Value> {
        if self.fail_sites.contains(&site.id) {
            return Err("Simulated outage (503 Service Unavailable)".into());
        }
        self.sites.get(site.id.as_str()).ok_or_else(|| format!("Could not connect to {}: no mock data for this site", site.base_url))
    }
}

fn issues(data: &Value) -> impl Iterator<Item = &Value> {
    data.get("issues").and_then(Value::as_array).into_iter().flatten()
}

/// A string field at a JSON pointer ("/fields/parent/key"), or "" when it's missing.
fn str_at<'a>(v: &'a Value, pointer: &str) -> &'a str {
    v.pointer(pointer).and_then(Value::as_str).unwrap_or_default()
}

/// `s` without `prefix`, matched ignoring ASCII case.
fn strip_prefix_ignore_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    s.get(..prefix.len()).filter(|head| head.eq_ignore_ascii_case(prefix))?;
    s.get(prefix.len()..)
}

#[derive(Debug, PartialEq)]
enum Field {
    Project,
    Key,
    Parent,
    StatusCategory,
    IssueLinkType,
}

#[derive(Debug, PartialEq)]
enum Clause {
    Match {
        field: Field,
        negate: bool,
        values: Vec<String>,
    },
    /// Accepted but not evaluated: the fixtures have no dates, sprints or users.
    Ignored,
}

/// Byte index of the ")" matching the "(" at `open`, skipping quoted text.
fn closing_paren(s: &str, open: usize) -> Option<usize> {
    let (mut depth, mut quote) = (0_i32, false);
    for (i, b) in s.bytes().enumerate().skip(open) {
        match b {
            b'"' => quote = !quote,
            b'(' if !quote => depth += 1,
            b')' if !quote => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// `s` without parentheses that wrap all of it, however many layers.
fn unwrap_parens(mut s: &str) -> &str {
    while let Some(inner) = s.strip_prefix('(').and_then(|t| t.strip_suffix(')')) {
        if closing_paren(s, 0) != Some(s.len() - 1) {
            break; // "(a) and (b)": the first ")" closes early, so the outer pair isn't one group
        }
        s = inner.trim();
    }
    s
}

/// Splits on AND at paren depth 0, outside quotes; nested groups are flattened.
fn split_top_level_and(input: &str) -> Vec<String> {
    let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = unwrap_parens(&normalized);
    let bytes = s.as_bytes();
    let (mut depth, mut quote, mut start, mut i) = (0_i32, false, 0_usize, 0_usize);
    let mut parts = Vec::new();
    // Split points sit on ASCII spaces, so every `get` below lands on a char boundary.
    while let Some(&b) = bytes.get(i) {
        match b {
            b'"' => quote = !quote,
            b'(' if !quote => depth += 1,
            b')' if !quote => depth -= 1,
            b' ' if !quote && depth == 0 && bytes.get(i..i + 5).is_some_and(|w| w.eq_ignore_ascii_case(b" and ")) => {
                parts.push(s.get(start..i).unwrap_or_default().to_owned());
                start = i + 5;
                i += 5;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    parts.push(s.get(start..).unwrap_or_default().to_owned());
    parts
        .into_iter()
        .flat_map(|p| {
            let t = p.trim();
            if t.starts_with('(') && closing_paren(t, 0) == Some(t.len() - 1) {
                split_top_level_and(t)
            } else {
                vec![t.to_owned()]
            }
        })
        .collect()
}

fn parse_jql(jql: &str) -> JiraResult<Vec<Clause>> {
    let body = strip_order_by(jql).trim();
    if body.is_empty() {
        return Ok(vec![]);
    }
    split_top_level_and(body)
        .into_iter()
        .map(|raw| {
            let unsupported =
                || format!("Mock backend can't evaluate \"{raw}\" (supports project, key, parent, statusCategory, issueLinkType)");
            let name_len = raw.bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
            // The name is ASCII, so `name_len` is a char boundary.
            let (name, rest) = raw.split_at_checked(name_len).ok_or_else(unsupported)?;
            let field_name = name.to_ascii_lowercase();
            let rest = rest.trim_start();
            if raw.to_ascii_lowercase().contains(" or ") {
                return Err("Mock backend doesn't support OR".to_owned());
            }
            let field = match field_name.as_str() {
                "project" => Field::Project,
                "key" => Field::Key,
                "parent" => Field::Parent,
                "statuscategory" => Field::StatusCategory,
                "issuelinktype" => Field::IssueLinkType,
                "updated" | "created" | "sprint" | "assignee" | "reporter" => return Ok(Clause::Ignored),
                _ => return Err(unsupported()),
            };
            let in_list = strip_prefix_ignore_case(rest, "in").filter(|r| r.trim_start().starts_with('('));
            let (negate, list) = if let Some(r) = strip_prefix_ignore_case(rest, "not in") {
                (true, r.trim())
            } else if let Some(r) = in_list {
                (false, r.trim())
            } else if let Some(r) = rest.strip_prefix("!=") {
                (true, r.trim())
            } else if let Some(r) = rest.strip_prefix('=') {
                (false, r.trim())
            } else {
                return Err(unsupported());
            };
            let list = list.strip_prefix('(').and_then(|l| l.strip_suffix(')')).unwrap_or(list);
            let values = list.split(',').map(|v| v.trim().trim_matches('"').to_ascii_lowercase()).filter(|v| !v.is_empty()).collect();
            Ok(Clause::Match { field, negate, values })
        })
        .collect()
}

fn matches(issue: &Value, clauses: &[Clause]) -> bool {
    let key = str_at(issue, "/key");
    clauses.iter().all(|c| {
        let Clause::Match { field, negate, values } = c else { return true };
        let actual: Vec<&str> = match field {
            Field::Project => vec![key.split('-').next().unwrap_or_default()],
            Field::Key => vec![key],
            Field::Parent => vec![str_at(issue, "/fields/parent/key")],
            Field::StatusCategory => {
                vec![str_at(issue, "/fields/status/statusCategory/name"), str_at(issue, "/fields/status/statusCategory/key")]
            }
            Field::IssueLinkType => issue
                .pointer("/fields/issuelinks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                // Jira matches the directional description ("blocks" / "is blocked by"), not the type name.
                .map(|l| str_at(l, if l.get("outwardIssue").is_some() { "/type/outward" } else { "/type/inward" }))
                .collect(),
        };
        let hit = actual.iter().any(|a| values.iter().any(|v| v.eq_ignore_ascii_case(a)));
        hit != *negate
    })
}

#[async_trait]
impl JiraBackend for MockBackend {
    async fn search(&self, site: &SiteConfig, jql: &str, max_results: Option<usize>) -> JiraResult<Vec<Value>> {
        let data = self.site_data(site)?;
        let clauses = parse_jql(jql)?;
        Ok(issues(data).filter(|i| matches(i, &clauses)).take(max_results.unwrap_or(usize::MAX)).cloned().collect())
    }

    async fn epic(&self, site: &SiteConfig, key: &str, filter: Option<&str>) -> JiraResult<Value> {
        let epic = self.issue(site, key).await?;
        if str_at(&epic, "/fields/issuetype/name") != "Epic" {
            return Err(format!("{key} is not an epic"));
        }
        let children = self.search(site, &and_filter(&format!("parent = {key}"), filter), None).await?;
        Ok(json!({ "epic": epic, "children": children }))
    }

    async fn issue(&self, site: &SiteConfig, key: &str) -> JiraResult<Value> {
        if !is_issue_key(key) {
            return Err(format!("\"{key}\" is not a valid issue key"));
        }
        let data = self.site_data(site)?;
        issues(data)
            .find(|i| str_at(i, "/key") == key)
            .cloned()
            .ok_or_else(|| format!("Issue {key} does not exist or you do not have permission to see it"))
    }

    async fn remote_links(&self, site: &SiteConfig, key: &str) -> JiraResult<Vec<Value>> {
        let data = self.site_data(site)?;
        Ok(data.get("remoteLinks").and_then(|links| links.get(key)).and_then(Value::as_array).cloned().unwrap_or_default())
    }

    async fn link_types(&self, site: &SiteConfig) -> JiraResult<Value> {
        self.site_data(site)?;
        Ok(self.link_types.clone())
    }

    async fn myself(&self, site: &SiteConfig) -> JiraResult<Value> {
        Ok(self.site_data(site)?.get("myself").cloned().unwrap_or(Value::Null))
    }

    async fn status_history(&self, site: &SiteConfig, issue_ids: &[String]) -> JiraResult<Value> {
        let logs = self.site_data(site)?.get("changelogs");
        let found: Vec<Value> = issue_ids
            .iter()
            .filter_map(|id| logs.and_then(|l| l.get(id)).map(|h| json!({ "issueId": id, "changeHistories": h })))
            .collect();
        Ok(json!({ "issueChangeLogs": found }))
    }

    async fn statuses(&self, site: &SiteConfig) -> JiraResult<Value> {
        Ok(self.site_data(site)?.get("statuses").cloned().unwrap_or(Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{DominoConfig, SEED_CONFIG};

    fn cfg() -> DominoConfig {
        serde_json::from_str(SEED_CONFIG).unwrap()
    }

    #[test]
    fn parses_supported_jql() {
        assert_eq!(
            parse_jql("project in (CORE, web) ORDER BY rank").unwrap(),
            vec![Clause::Match { field: Field::Project, negate: false, values: vec!["core".into(), "web".into()] }]
        );
        assert_eq!(parse_jql("parent = CORE-1 and key in (A-1)").unwrap().len(), 2);
        let preset = parse_jql(
            r#"(project in (CORE, WEB)) AND statusCategory != Done AND issueLinkType in (blocks, "is blocked by") AND updated >= -30d"#,
        )
        .unwrap();
        assert_eq!(preset.len(), 4);
        assert_eq!(preset[1], Clause::Match { field: Field::StatusCategory, negate: true, values: vec!["done".into()] });
        assert_eq!(preset[3], Clause::Ignored);
        parse_jql("labels = x").unwrap_err();
        parse_jql("project = A OR project = B").unwrap_err();
    }

    #[tokio::test]
    async fn evaluates_status_category_and_link_type() {
        let b = MockBackend::new(HashSet::new()).unwrap();
        let c = cfg();
        let acme = c.site("acme").unwrap();
        let open_blockers = b
            .search(acme, r#"(project in (CORE, WEB)) AND statusCategory != Done AND issueLinkType in (blocks, "is blocked by")"#, None)
            .await
            .unwrap();
        let keys: Vec<&str> = open_blockers.iter().map(|i| i["key"].as_str().unwrap()).collect();
        assert!(keys.contains(&"CORE-11") && keys.contains(&"WEB-2"));
        assert!(!keys.contains(&"CORE-12"), "Done issues are excluded");
        assert!(!keys.contains(&"WEB-3"), "issues with only duplicate links are excluded");
        let blockers_only = b.search(acme, "issueLinkType = blocks", None).await.unwrap();
        assert!(blockers_only.iter().all(|i| i["key"] != "WEB-2"), "WEB-2 is only blocked, never blocks");
    }

    #[tokio::test]
    async fn serves_fixtures_by_site() {
        let b = MockBackend::new(HashSet::new()).unwrap();
        let c = cfg();
        let acme = c.site("acme").unwrap();
        let partner = c.site("partner").unwrap();
        assert_eq!(b.search(acme, "project in (CORE, WEB)", None).await.unwrap().len(), 17);
        assert_eq!(b.issue(acme, "CORE-7").await.unwrap()["fields"]["summary"], "Rate limiter for public API");
        assert_eq!(b.issue(partner, "CORE-7").await.unwrap()["fields"]["summary"], "Partner onboarding checklist");
        let epic = b.epic(acme, "CORE-1", None).await.unwrap();
        assert_eq!(epic["children"].as_array().unwrap().len(), 4);
        let filtered = b.epic(acme, "CORE-1", Some("project = WEB")).await.unwrap();
        assert_eq!(filtered["children"].as_array().unwrap().len(), 2);
        assert_eq!(b.remote_links(partner, "PAY-3").await.unwrap().len(), 1);
        assert_eq!(b.search(acme, "key in (CORE-7, WEB-1)", Some(1)).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn serves_status_history_and_statuses() {
        let b = MockBackend::new(HashSet::new()).unwrap();
        let c = cfg();
        let partner = c.site("partner").unwrap();
        let pay1 = b.issue(partner, "PAY-1").await.unwrap();
        let id = pay1["id"].as_str().unwrap().to_owned();
        let v = b.status_history(partner, &[id.clone(), "999".into()]).await.unwrap();
        let logs = v["issueChangeLogs"].as_array().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["issueId"], id.as_str());
        assert!(pay1["fields"]["resolutiondate"].is_string());
        assert!(!b.statuses(partner).await.unwrap().as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn serves_the_signed_in_user_and_reporters() {
        let b = MockBackend::new(HashSet::new()).unwrap();
        let c = cfg();
        for id in ["acme", "partner"] {
            let me = b.myself(c.site(id).unwrap()).await.unwrap();
            assert_eq!(me["accountId"], "acc-jonas-berg", "{id}");
        }
        b.health(c.site("acme").unwrap()).await.unwrap();
        let web1 = b.issue(c.site("acme").unwrap(), "WEB-1").await.unwrap();
        assert_eq!(web1["fields"]["reporter"]["accountId"], "acc-jonas-berg");
    }

    #[tokio::test]
    async fn fails_for_unknown_and_simulated_sites() {
        let b = MockBackend::new(HashSet::from(["partner".to_owned()])).unwrap();
        let c = cfg();
        b.health(c.site("acme").unwrap()).await.unwrap();
        assert!(b.health(c.site("partner").unwrap()).await.unwrap_err().contains("Simulated outage"));
        assert!(b.health(c.site("legacy").unwrap()).await.unwrap_err().contains("no mock data"));
    }
}

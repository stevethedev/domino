//! Phase 1 backend: serves the shared fixtures in fixtures/mock/ and evaluates
//! a tiny JQL subset (kept in sync with src/data/FixtureSource.ts).

use super::{and_filter, is_issue_key, JiraBackend, JiraResult};
use crate::config::SiteConfig;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const ACME: &str = include_str!("../../../fixtures/mock/acme.json");
const PARTNER: &str = include_str!("../../../fixtures/mock/partner.json");
const LINK_TYPES: &str = include_str!("../../../fixtures/mock/linkTypes.json");

pub struct MockBackend {
    sites: HashMap<&'static str, Value>,
    link_types: Value,
    fail_sites: HashSet<String>,
}

impl MockBackend {
    /// `fail_sites` simulate outages (set via `DOMINO_MOCK_FAIL_SITES=partner,acme`).
    pub fn new(fail_sites: HashSet<String>) -> Self {
        let parse = |s: &str| serde_json::from_str::<Value>(s).expect("mock fixture is valid JSON");
        Self {
            sites: HashMap::from([("acme", parse(ACME)), ("partner", parse(PARTNER))]),
            link_types: parse(LINK_TYPES),
            fail_sites,
        }
    }

    pub fn from_env() -> Self {
        let fail = std::env::var("DOMINO_MOCK_FAIL_SITES")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Self::new(fail)
    }

    fn site_data(&self, site: &SiteConfig) -> JiraResult<&Value> {
        if self.fail_sites.contains(&site.id) {
            return Err("Simulated outage (503 Service Unavailable)".into());
        }
        self.sites
            .get(site.id.as_str())
            .ok_or_else(|| format!("Could not connect to {}: no mock data for this site", site.base_url))
    }

    fn issues<'a>(&self, data: &'a Value) -> impl Iterator<Item = &'a Value> {
        data["issues"].as_array().into_iter().flatten()
    }
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
    Match { field: Field, negate: bool, values: Vec<String> },
    /// Accepted but not evaluated: the fixtures have no dates, sprints or users.
    Ignored,
}

/// Byte index of the ")" matching the "(" at `open`, skipping quoted text.
fn closing_paren(s: &str, open: usize) -> Option<usize> {
    let (mut depth, mut quote) = (0i32, false);
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

fn unwrap_parens(mut s: &str) -> &str {
    while s.starts_with('(') && closing_paren(s, 0) == Some(s.len() - 1) {
        s = s[1..s.len() - 1].trim();
    }
    s
}

/// Splits on AND at paren depth 0, outside quotes; nested groups are flattened.
fn split_top_level_and(input: &str) -> Vec<String> {
    let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = unwrap_parens(&normalized);
    let bytes = s.as_bytes();
    let (mut depth, mut quote, mut start, mut i) = (0i32, false, 0usize, 0usize);
    let mut parts = Vec::new();
    while i < bytes.len() {
        match bytes[i] {
            b'"' => quote = !quote,
            b'(' if !quote => depth += 1,
            b')' if !quote => depth -= 1,
            b' ' if !quote && depth == 0 && bytes.len() >= i + 5 && bytes[i..i + 5].eq_ignore_ascii_case(b" and ") => {
                parts.push(s[start..i].to_string());
                start = i + 5;
                i += 5;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    parts.push(s[start..].to_string());
    parts
        .into_iter()
        .flat_map(|p| {
            let t = p.trim();
            if t.starts_with('(') && closing_paren(t, 0) == Some(t.len() - 1) {
                split_top_level_and(t)
            } else {
                vec![t.to_string()]
            }
        })
        .collect()
}

fn strip_order_by(jql: &str) -> &str {
    let lower = jql.to_ascii_lowercase();
    match lower.find(" order by ") {
        Some(i) => &jql[..i],
        None if lower.starts_with("order by ") => "",
        None => jql,
    }
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
            let field_name = raw[..name_len].to_ascii_lowercase();
            let rest = raw[name_len..].trim_start();
            if [" or "].iter().any(|kw| raw.to_ascii_lowercase().contains(kw)) {
                return Err("Mock backend doesn't support OR".to_string());
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
            let lower = rest.to_ascii_lowercase();
            let (negate, list) = if lower.starts_with("not in") {
                (true, rest[6..].trim())
            } else if lower.starts_with("in") && rest[2..].trim_start().starts_with('(') {
                (false, rest[2..].trim())
            } else if let Some(r) = rest.strip_prefix("!=") {
                (true, r.trim())
            } else if let Some(r) = rest.strip_prefix('=') {
                (false, r.trim())
            } else {
                return Err(unsupported());
            };
            let list = list.strip_prefix('(').and_then(|l| l.strip_suffix(')')).unwrap_or(list);
            let values = list
                .split(',')
                .map(|v| v.trim().trim_matches('"').to_ascii_lowercase())
                .filter(|v| !v.is_empty())
                .collect();
            Ok(Clause::Match { field, negate, values })
        })
        .collect()
}

fn matches(issue: &Value, clauses: &[Clause]) -> bool {
    let key = issue["key"].as_str().unwrap_or_default();
    let f = &issue["fields"];
    clauses.iter().all(|c| {
        let Clause::Match { field, negate, values } = c else { return true };
        let actual: Vec<&str> = match field {
            Field::Project => vec![key.split('-').next().unwrap_or_default()],
            Field::Key => vec![key],
            Field::Parent => vec![f["parent"]["key"].as_str().unwrap_or_default()],
            Field::StatusCategory => {
                let cat = &f["status"]["statusCategory"];
                vec![cat["name"].as_str().unwrap_or_default(), cat["key"].as_str().unwrap_or_default()]
            }
            Field::IssueLinkType => f["issuelinks"]
                .as_array()
                .into_iter()
                .flatten()
                // Jira matches the directional description ("blocks" / "is blocked by"), not the type name.
                .map(|l| {
                    let side = if l.get("outwardIssue").is_some() { "outward" } else { "inward" };
                    l["type"][side].as_str().unwrap_or_default()
                })
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
        Ok(self
            .issues(data)
            .filter(|i| matches(i, &clauses))
            .take(max_results.unwrap_or(usize::MAX))
            .cloned()
            .collect())
    }

    async fn epic(&self, site: &SiteConfig, key: &str, filter: Option<&str>) -> JiraResult<Value> {
        let epic = self.issue(site, key).await?;
        if epic["fields"]["issuetype"]["name"] != "Epic" {
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
        self.issues(data)
            .find(|i| i["key"] == key)
            .cloned()
            .ok_or_else(|| format!("Issue {key} does not exist or you do not have permission to see it"))
    }

    async fn remote_links(&self, site: &SiteConfig, key: &str) -> JiraResult<Vec<Value>> {
        let data = self.site_data(site)?;
        Ok(data["remoteLinks"][key].as_array().cloned().unwrap_or_default())
    }

    async fn link_types(&self, site: &SiteConfig) -> JiraResult<Value> {
        self.site_data(site)?;
        Ok(self.link_types.clone())
    }

    async fn health(&self, site: &SiteConfig) -> JiraResult<()> {
        self.site_data(site).map(|_| ())
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
        let preset = parse_jql(r#"(project in (CORE, WEB)) AND statusCategory != Done AND issueLinkType in (blocks, "is blocked by") AND updated >= -30d"#).unwrap();
        assert_eq!(preset.len(), 4);
        assert_eq!(preset[1], Clause::Match { field: Field::StatusCategory, negate: true, values: vec!["done".into()] });
        assert_eq!(preset[3], Clause::Ignored);
        assert!(parse_jql("labels = x").is_err());
        assert!(parse_jql("project = A OR project = B").is_err());
    }

    #[tokio::test]
    async fn evaluates_status_category_and_link_type() {
        let b = MockBackend::new(HashSet::new());
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
        let blockers_only = b.search(acme, r#"issueLinkType = blocks"#, None).await.unwrap();
        assert!(blockers_only.iter().all(|i| i["key"] != "WEB-2"), "WEB-2 is only blocked, never blocks");
    }

    #[tokio::test]
    async fn serves_fixtures_by_site() {
        let b = MockBackend::new(HashSet::new());
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
    async fn fails_for_unknown_and_simulated_sites() {
        let b = MockBackend::new(HashSet::from(["partner".to_string()]));
        let c = cfg();
        assert!(b.health(c.site("acme").unwrap()).await.is_ok());
        assert!(b.health(c.site("partner").unwrap()).await.unwrap_err().contains("Simulated outage"));
        assert!(b.health(c.site("legacy").unwrap()).await.unwrap_err().contains("no mock data"));
    }
}

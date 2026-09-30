//! Raw, Jira-shaped data access. Values are passed through as JSON so the
//! webview receives exactly what Jira REST v3 returns.

pub mod http;
pub mod mock;
pub mod oauth;

use crate::config::SiteConfig;
use async_trait::async_trait;
use serde_json::Value;

pub type JiraResult<T> = Result<T, String>;

#[async_trait]
pub trait JiraBackend: Send + Sync {
    /// Issues matching `jql`, paging until done or `max_results` is reached.
    async fn search(&self, site: &SiteConfig, jql: &str, max_results: Option<usize>) -> JiraResult<Vec<Value>>;
    /// `{ "epic": Issue, "children": [Issue] }`. `filter` (JQL) is ANDed onto `parent = KEY`.
    async fn epic(&self, site: &SiteConfig, key: &str, filter: Option<&str>) -> JiraResult<Value>;
    async fn issue(&self, site: &SiteConfig, key: &str) -> JiraResult<Value>;
    async fn remote_links(&self, site: &SiteConfig, key: &str) -> JiraResult<Vec<Value>>;
    /// `{ "issueLinkTypes": [...] }`
    async fn link_types(&self, site: &SiteConfig) -> JiraResult<Value>;
    /// Ok when the site is reachable and credentials work.
    async fn health(&self, site: &SiteConfig) -> JiraResult<()>;
}

/// The JQL before any `ORDER BY`.
pub fn strip_order_by(jql: &str) -> &str {
    let lower = jql.to_ascii_lowercase();
    match lower.find(" order by ") {
        Some(i) => &jql[..i],
        None if lower.trim_start().starts_with("order by ") => "",
        None => jql,
    }
}

/// `clause AND (filter)`, or just `clause` when there's no filter. The filter's ORDER BY is
/// dropped, since ORDER BY can't appear inside parentheses.
pub fn and_filter(clause: &str, filter: Option<&str>) -> String {
    match filter.map(|f| strip_order_by(f).trim()).filter(|f| !f.is_empty()) {
        Some(f) => format!("{clause} AND ({f})"),
        None => clause.to_string(),
    }
}


pub fn is_issue_key(s: &str) -> bool {
    let Some((proj, num)) = s.split_once('-') else { return false };
    proj.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && proj.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !num.is_empty()
        && num.chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn and_filter_parenthesizes_and_drops_order_by() {
        assert_eq!(and_filter("parent = A-1", Some("project = A OR project = B ORDER BY rank")), "parent = A-1 AND (project = A OR project = B)");
        assert_eq!(and_filter("parent = A-1", Some("  ")), "parent = A-1");
        assert_eq!(and_filter("parent = A-1", Some("ORDER BY rank")), "parent = A-1");
        assert_eq!(and_filter("parent = A-1", None), "parent = A-1");
    }
}

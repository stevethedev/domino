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

/// `(filter) AND clause`, or just `clause` when there's no filter.
pub fn and_filter(clause: &str, filter: Option<&str>) -> String {
    match filter.map(str::trim).filter(|f| !f.is_empty()) {
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

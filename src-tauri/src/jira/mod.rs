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
    async fn health(&self, site: &SiteConfig) -> JiraResult<()> {
        self.myself(site).await.map(|_| ())
    }
    /// `GET /rest/api/3/myself`: the signed-in user on this site (`accountId`, `displayName`, ...).
    async fn myself(&self, site: &SiteConfig) -> JiraResult<Value>;
    /// `{ "issueChangeLogs": [...] }` with status changes for these issue ids, all pages merged.
    async fn status_history(&self, site: &SiteConfig, issue_ids: &[String]) -> JiraResult<Value>;
    /// `GET /rest/api/3/status`: every status with its category.
    async fn statuses(&self, site: &SiteConfig) -> JiraResult<Value>;
}

/// The JQL before any `ORDER BY` (any whitespace around the keywords, like the TS `combineJql`).
pub fn strip_order_by(jql: &str) -> &str {
    let bytes = jql.as_bytes();
    let at_word = |i: usize, word: &[u8]| bytes.len() >= i + word.len() && bytes[i..i + word.len()].eq_ignore_ascii_case(word);
    let skip_ws = |mut i: usize| {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        i
    };
    for i in 0..bytes.len() {
        let starts_clause = i == 0 || bytes[i - 1].is_ascii_whitespace();
        if !starts_clause || !at_word(i, b"order") {
            continue;
        }
        let by = skip_ws(i + 5);
        if by > i + 5 && at_word(by, b"by") && by + 2 < bytes.len() && bytes[by + 2].is_ascii_whitespace() {
            return jql[..i].trim_end(); // ASCII keyword boundary, so `i` is a char boundary
        }
    }
    jql
}

/// `clause AND (filter)`, or just `clause` when there's no filter. The filter's ORDER BY is
/// dropped, since ORDER BY can't appear inside parentheses.
pub fn and_filter(clause: &str, filter: Option<&str>) -> String {
    match filter.map(|f| strip_order_by(f).trim()).filter(|f| !f.is_empty()) {
        Some(f) => format!("{clause} AND ({f})"),
        None => clause.to_string(),
    }
}


pub fn is_issue_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
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
    fn strip_order_by_accepts_any_whitespace() {
        assert_eq!(strip_order_by("project = A\tORDER\n BY rank"), "project = A");
        assert_eq!(strip_order_by("ORDER BY rank"), "");
        assert_eq!(strip_order_by("project = A"), "project = A");
        assert_eq!(strip_order_by("reorder = x"), "reorder = x");
        assert_eq!(strip_order_by("summary = orderly"), "summary = orderly");
    }

    #[test]
    fn and_filter_parenthesizes_and_drops_order_by() {
        assert_eq!(and_filter("parent = A-1", Some("project = A OR project = B ORDER BY rank")), "parent = A-1 AND (project = A OR project = B)");
        assert_eq!(and_filter("parent = A-1", Some("  ")), "parent = A-1");
        assert_eq!(and_filter("parent = A-1", Some("ORDER BY rank")), "parent = A-1");
        assert_eq!(and_filter("parent = A-1", None), "parent = A-1");
    }
}

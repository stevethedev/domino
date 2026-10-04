//! Raw, Jira-shaped data access. Values are passed through as JSON so the
//! webview receives exactly what Jira REST v3 returns.

pub(crate) mod http;
pub(crate) mod mock;
pub(crate) mod oauth;

use crate::config::SiteConfig;
use async_trait::async_trait;
use serde_json::Value;

pub(crate) type JiraResult<T> = Result<T, String>;

#[async_trait]
pub(crate) trait JiraBackend: Send + Sync {
    /// Issues matching `jql`, paging until done or `max_results` is reached.
    async fn search(&self, site: &SiteConfig, jql: &str, max_results: Option<usize>) -> JiraResult<Vec<Value>>;
    /// `{ "epic": Issue, "children": [Issue] }`. `filter` (JQL) is `ANDed` onto `parent = KEY`.
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
    /// Every priority (`id`, `name`, `iconUrl`, ...), in the site's configured order: most severe first.
    async fn priorities(&self, site: &SiteConfig) -> JiraResult<Vec<Value>>;
}

/// The JQL before any `ORDER BY` (any whitespace around the keywords, like the TS `combineJql`).
pub(crate) fn strip_order_by(jql: &str) -> &str {
    let bytes = jql.as_bytes();
    let is_ws = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_whitespace);
    let at_word = |i: usize, word: &[u8]| bytes.get(i..i + word.len()).is_some_and(|w| w.eq_ignore_ascii_case(word));
    let skip_ws = |mut i: usize| {
        while is_ws(i) {
            i += 1;
        }
        i
    };
    for i in 0..bytes.len() {
        let starts_clause = i == 0 || is_ws(i - 1);
        if !starts_clause || !at_word(i, b"order") {
            continue;
        }
        let by = skip_ws(i + 5);
        if by > i + 5 && at_word(by, b"by") && is_ws(by + 2) {
            // `i` starts an ASCII keyword, so it's a char boundary and `get` succeeds.
            return jql.get(..i).map_or(jql, str::trim_end);
        }
    }
    jql
}

/// `clause AND (filter)`, or just `clause` when there's no filter. The filter's ORDER BY is
/// dropped, since ORDER BY can't appear inside parentheses.
pub(crate) fn and_filter(clause: &str, filter: Option<&str>) -> String {
    filter.map(|f| strip_order_by(f).trim()).filter(|f| !f.is_empty()).map_or_else(|| clause.to_owned(), |f| format!("{clause} AND ({f})"))
}

pub(crate) fn is_issue_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
}

pub(crate) fn is_issue_key(s: &str) -> bool {
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
        assert_eq!(
            and_filter("parent = A-1", Some("project = A OR project = B ORDER BY rank")),
            "parent = A-1 AND (project = A OR project = B)"
        );
        assert_eq!(and_filter("parent = A-1", Some("  ")), "parent = A-1");
        assert_eq!(and_filter("parent = A-1", Some("ORDER BY rank")), "parent = A-1");
        assert_eq!(and_filter("parent = A-1", None), "parent = A-1");
    }
}

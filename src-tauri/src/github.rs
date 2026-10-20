//! Raw GitHub data access (issues and pull requests) over the GraphQL API. Like `jira`, values are
//! passed through as JSON: the webview maps GitHub's nodes onto its Jira-shaped model. Only the
//! fixed queries in `github/queries/` are ever sent; the webview supplies variables, never GraphQL.

pub(crate) mod http;
pub(crate) mod mock;

use crate::config::SiteConfig;
use async_trait::async_trait;
use serde_json::Value;

pub(crate) type GitHubResult<T> = Result<T, String>;

const ISSUE_FRAGMENTS: &str = include_str!("github/queries/issue_fragments.graphql");
const PULL_FRAGMENTS: &str = include_str!("github/queries/pull_fragments.graphql");
const SEARCH: &str = include_str!("github/queries/search.graphql");
const SUB_ISSUES: &str = include_str!("github/queries/sub_issues.graphql");
const VIEWER: &str = include_str!("github/queries/viewer.graphql");

/// Most keys looked up in one request (each is its own aliased field).
pub(crate) const KEY_BATCH: usize = 50;

#[async_trait]
pub(crate) trait GitHubBackend: Send + Sync {
    /// Issues and pull requests matching a GitHub search, paging until done or `max_results` is reached.
    async fn search(&self, site: &SiteConfig, query: &str, max_results: Option<usize>) -> GitHubResult<Vec<Value>>;
    /// Issues and pull requests by key (`owner/repo#12`). Ones that don't exist, or can't be seen, are left out.
    async fn issues(&self, site: &SiteConfig, keys: &[String]) -> GitHubResult<Vec<Value>>;
    /// Every sub-issue of the issue `key`.
    async fn sub_issues(&self, site: &SiteConfig, key: &str) -> GitHubResult<Vec<Value>>;
    /// The signed-in user (`login`, `name`, `avatarUrl`).
    async fn viewer(&self, site: &SiteConfig) -> GitHubResult<Value>;
    /// Ok when the host is reachable and the token works.
    async fn health(&self, site: &SiteConfig) -> GitHubResult<()> {
        self.viewer(site).await.map(|_| ())
    }
}

/// An issue or pull request, parsed from its key `owner/repo#number`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct IssueRef<'a> {
    pub owner: &'a str,
    pub repo: &'a str,
    pub number: u32,
}

/// GitHub's rules: owners are 1-39 letters, digits and inner dashes; repos are 1-100 letters, digits,
/// `.`, `_` and `-` (but not `.` or `..`). Numbers are positive and fit GraphQL's 32-bit `Int`.
pub(crate) fn parse_key(key: &str) -> Option<IssueRef<'_>> {
    let (path, number) = key.split_once('#')?;
    let (owner, repo) = path.split_once('/')?;
    let owner_ok = (1..=39).contains(&owner.len())
        && owner.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !owner.starts_with('-')
        && !owner.ends_with('-');
    let repo_ok = (1..=100).contains(&repo.len())
        && repo.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && repo != "."
        && repo != "..";
    let number_ok = (1..=10).contains(&number.len()) && number.bytes().all(|b| b.is_ascii_digit());
    let number = number.parse::<u32>().ok().filter(|n| number_ok && *n > 0 && i32::try_from(*n).is_ok())?;
    (owner_ok && repo_ok).then_some(IssueRef { owner, repo, number })
}

pub(crate) fn check_key(key: &str) -> GitHubResult<IssueRef<'_>> {
    parse_key(key).ok_or_else(|| format!("\"{key}\" is not a valid GitHub issue key (expected owner/repo#123)"))
}

pub(crate) fn search_query() -> String {
    format!("{SEARCH}\n{ISSUE_FRAGMENTS}\n{PULL_FRAGMENTS}")
}

pub(crate) fn sub_issues_query() -> String {
    format!("{SUB_ISSUES}\n{ISSUE_FRAGMENTS}")
}

pub(crate) const fn viewer_query() -> &'static str {
    VIEWER
}

/// One aliased `repository(...) { issueOrPullRequest(...) }` field per key (`k0`, `k1`, ...). Keys go
/// in as variables (`$o0`, `$r0`, `$n0`, ...), never into the query text.
pub(crate) fn issues_query(count: usize) -> String {
    let vars: Vec<String> = (0..count).map(|i| format!("$o{i}: String!, $r{i}: String!, $n{i}: Int!")).collect();
    let fields: Vec<String> = (0..count)
        .map(|i| {
            format!(
                "  k{i}: repository(owner: $o{i}, name: $r{i}) {{ issueOrPullRequest(number: $n{i}) {{ ...IssueTicket ...PullTicket }} }}"
            )
        })
        .collect();
    format!("query Issues({}) {{\n{}\n}}\n{ISSUE_FRAGMENTS}\n{PULL_FRAGMENTS}", vars.join(", "), fields.join("\n"))
}

/// The variables for `issues_query`.
pub(crate) fn issues_variables(refs: &[IssueRef<'_>]) -> Value {
    let mut vars = serde_json::Map::new();
    for (i, r) in refs.iter().enumerate() {
        vars.insert(format!("o{i}"), r.owner.into());
        vars.insert(format!("r{i}"), r.repo.into());
        vars.insert(format!("n{i}"), r.number.into());
    }
    Value::Object(vars)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_keys() {
        assert_eq!(parse_key("acme/web#42"), Some(IssueRef { owner: "acme", repo: "web", number: 42 }));
        assert_eq!(parse_key("a-b/x.y_z-1#1").map(|r| r.repo), Some("x.y_z-1"));
    }

    #[test]
    fn rejects_malformed_and_injected_keys() {
        for bad in [
            "",
            "acme/web",
            "acme#1",
            "acme/web#",
            "acme/web#0",
            "acme/web#-1",
            "acme/web#2147483648",
            "acme/web#12345678901",
            "-acme/web#1",
            "acme-/web#1",
            "ac me/web#1",
            "acme/../x#1",
            "acme/..#1",
            "acme/web/x#1",
            "acme/web#1#2",
            "acme/we\"b#1",
            "CORE-1",
        ] {
            assert_eq!(parse_key(bad), None, "{bad}");
        }
        assert!(check_key("../admin").unwrap_err().contains("owner/repo#123"));
    }

    #[test]
    fn every_query_uses_each_fragment_it_sends() {
        // GraphQL rejects a document with an unused fragment.
        for q in [search_query(), issues_query(2)] {
            for f in ["IssueTicket", "PullTicket", "LinkedIssue", "LinkedPull", "References", "PullReferences"] {
                assert!(q.contains(&format!("...{f}")), "{f} unused");
            }
        }
        let sub = sub_issues_query();
        assert!(!sub.contains("fragment PullTicket") && sub.contains("...IssueTicket"));
    }

    #[test]
    fn pull_request_fragments_alias_state() {
        // Issue.state (IssueState) and PullRequest.state (PullRequestState) can't share a response
        // name: GraphQL rejects the document even though the fragments never both match.
        for fragments in [ISSUE_FRAGMENTS, PULL_FRAGMENTS] {
            for block in fragments.split("fragment ").filter(|b| b.contains(" on PullRequest ")) {
                // Top-level fields only: `milestone { state }` is a MilestoneState on both types.
                assert!(!block.lines().any(|l| l == "  state"), "unaliased state in {}", block.lines().next().unwrap_or_default());
                assert!(block.contains("pullState: state"), "{}", block.lines().next().unwrap_or_default());
            }
        }
    }

    #[test]
    fn timelines_report_whether_they_were_cut_short_and_include_disconnections() {
        for (fragments, name) in [(ISSUE_FRAGMENTS, "References"), (PULL_FRAGMENTS, "PullReferences")] {
            let block = fragments.split("fragment ").find(|b| b.starts_with(name)).unwrap();
            assert!(block.contains("pageInfo") && block.contains("hasNextPage"), "{name}");
            assert!(block.contains("... on DisconnectedEvent"), "{name}");
        }
        for (fragments, name) in [(ISSUE_FRAGMENTS, "IssueTicket"), (PULL_FRAGMENTS, "PullTicket")] {
            let block = fragments.split("fragment ").find(|b| b.starts_with(name)).unwrap();
            assert!(
                block.contains("timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT, DISCONNECTED_EVENT])"),
                "{name}"
            );
            assert!(block.lines().any(|l| l.trim() == "body"), "{name} fetches the raw Markdown body");
        }
    }

    #[test]
    fn issue_lookups_pass_keys_as_variables() {
        let refs = [parse_key("acme/web#42").unwrap(), parse_key("acme/api#7").unwrap()];
        let q = issues_query(refs.len());
        assert!(q.starts_with("query Issues($o0: String!, $r0: String!, $n0: Int!, $o1: String!, $r1: String!, $n1: Int!)"));
        assert!(q.contains("k1: repository(owner: $o1, name: $r1) { issueOrPullRequest(number: $n1)"));
        assert!(!q.contains("acme"));
        assert_eq!(issues_variables(&refs), serde_json::json!({ "o0": "acme", "r0": "web", "n0": 42, "o1": "acme", "r1": "api", "n1": 7 }));
    }
}

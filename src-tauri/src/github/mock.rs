//! Serves fixtures/mock/github.json and evaluates a small advanced-search subset (kept in sync with
//! src/data/github/FixtureGitHubApi.ts).

use super::{check_key, GitHubBackend, GitHubResult};
use crate::config::SiteConfig;
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashSet;

const GITHUB: &str = include_str!("../../../fixtures/mock/github.json");

pub(crate) struct GitHubMock {
    data: Value,
    fail_sites: HashSet<String>,
}

/// `owner/repo#number` of a node, or of a linked issue embedded in one, lower-cased as the webview keys it.
fn key_of(node: &Value) -> Option<String> {
    let repo = node.pointer("/repository/nameWithOwner")?.as_str()?;
    Some(format!("{}#{}", repo.to_ascii_lowercase(), node.get("number")?.as_u64()?))
}

/// One search qualifier against a node. Free text and qualifiers the fixtures can't answer match everything.
fn matches_term(node: &Value, term: &str, viewer: &str) -> bool {
    let (negate, term) = term.strip_prefix('-').map_or((false, term), |t| (true, t));
    let repo = node.pointer("/repository/nameWithOwner").and_then(Value::as_str).unwrap_or_default();
    let is_pr = node.get("__typename").and_then(Value::as_str) == Some("PullRequest");
    // Pull requests' state is aliased to `pullState` (see pull_fragments.graphql).
    let state = node.get(if is_pr { "pullState" } else { "state" }).and_then(Value::as_str).unwrap_or_default();
    let Some((qualifier, value)) = term.split_once(':') else { return true };
    let value = value.strip_prefix('"').map_or(value, |v| v.strip_suffix('"').unwrap_or(v));
    let hit = match (qualifier.to_ascii_lowercase().as_str(), value.to_ascii_lowercase().as_str()) {
        ("repo", v) => repo.eq_ignore_ascii_case(v),
        ("org" | "user", v) => repo.split('/').next().is_some_and(|o| o.eq_ignore_ascii_case(v)),
        ("is" | "state", "open") => state == "OPEN",
        ("is" | "state", "closed") => state != "OPEN",
        ("is", "merged") => state == "MERGED",
        ("is" | "type", "issue") => !is_pr,
        ("is" | "type", "pr") => is_pr,
        ("assignee", v) => {
            let login = if v == "@me" { viewer } else { v };
            node.pointer("/assignees/nodes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|a| a.get("login").and_then(Value::as_str).is_some_and(|l| l.eq_ignore_ascii_case(login)))
        }
        _ => return true,
    };
    hit != negate
}

/// A search's terms, split on whitespace outside quoted phrases (an unclosed one runs to the end).
fn terms(query: &str) -> Vec<&str> {
    let mut terms = Vec::new();
    let (mut start, mut quoted) = (None, false);
    for (i, c) in query.char_indices() {
        if c == '"' {
            quoted = !quoted;
        }
        if c.is_whitespace() && !quoted {
            terms.extend(start.take().and_then(|s| query.get(s..i)));
        } else if start.is_none() {
            start = Some(i);
        }
    }
    terms.extend(start.and_then(|s| query.get(s..)));
    terms
}

/// A search as GitHub's advanced search reads it (kept in step with `parseSearch` in query.ts).
enum Search<'a> {
    Term(&'a str),
    And(Vec<Self>),
    Or(Vec<Self>),
    Not(Box<Self>),
}

impl<'a> Search<'a> {
    /// OR binds loosest, then AND (also implicit), then NOT; an unbalanced parenthesis is forgiven.
    fn parse(query: &'a str) -> Self {
        let mut tokens = Vec::new();
        for term in terms(query) {
            let rest = term.trim_start_matches('(');
            let middle = rest.trim_end_matches(')');
            tokens.extend(std::iter::repeat("(").take(term.len() - rest.len()));
            if !middle.is_empty() {
                tokens.push(middle);
            }
            tokens.extend(std::iter::repeat(")").take(rest.len() - middle.len()));
        }
        let mut at = 0;
        let mut parts = vec![Self::or(&tokens, &mut at)];
        while let Some(&t) = tokens.get(at) {
            if t == ")" {
                at += 1;
            } else {
                parts.push(Self::or(&tokens, &mut at));
            }
        }
        Self::group(parts, Self::And)
    }

    fn group(mut items: Vec<Self>, kind: fn(Vec<Self>) -> Self) -> Self {
        if items.len() == 1 {
            items.remove(0)
        } else {
            kind(items)
        }
    }

    fn or(tokens: &[&'a str], at: &mut usize) -> Self {
        let mut items = vec![Self::and(tokens, at)];
        while tokens.get(*at) == Some(&"OR") {
            *at += 1;
            items.push(Self::and(tokens, at));
        }
        Self::group(items, Self::Or)
    }

    fn and(tokens: &[&'a str], at: &mut usize) -> Self {
        let mut items = Vec::new();
        while let Some(&t) = tokens.get(*at) {
            match t {
                ")" | "OR" => break,
                "AND" => *at += 1,
                _ => items.push(Self::unary(tokens, at)),
            }
        }
        Self::group(items, Self::And)
    }

    fn unary(tokens: &[&'a str], at: &mut usize) -> Self {
        let Some(&t) = tokens.get(*at) else { return Self::And(Vec::new()) };
        *at += 1;
        match t {
            "NOT" if tokens.get(*at).is_some_and(|&next| next != ")") => Self::Not(Box::new(Self::unary(tokens, at))),
            "NOT" => Self::And(Vec::new()),
            "(" => {
                let inner = Self::or(tokens, at);
                if tokens.get(*at) == Some(&")") {
                    *at += 1;
                }
                inner
            }
            _ => Self::Term(t),
        }
    }

    fn matches(&self, node: &Value, viewer: &str) -> bool {
        match self {
            Self::Term(t) => matches_term(node, t, viewer),
            Self::And(items) => items.iter().all(|s| s.matches(node, viewer)),
            Self::Or(items) => items.iter().any(|s| s.matches(node, viewer)),
            Self::Not(item) => !item.matches(node, viewer),
        }
    }
}

impl GitHubMock {
    /// `fail_sites` simulate outages, as for the Jira mock. Fails only if the embedded fixture isn't valid JSON.
    pub(crate) fn new(fail_sites: HashSet<String>) -> serde_json::Result<Self> {
        Ok(Self { data: serde_json::from_str(GITHUB)?, fail_sites })
    }

    pub(crate) fn from_env() -> serde_json::Result<Self> {
        Self::new(crate::jira::mock::fail_sites_from_env())
    }

    fn nodes(&self, site: &SiteConfig) -> GitHubResult<impl Iterator<Item = &Value>> {
        if self.fail_sites.contains(&site.id) {
            return Err("Simulated outage (503 Service Unavailable)".into());
        }
        Ok(self.data.get("issues").and_then(Value::as_array).into_iter().flatten())
    }

    fn viewer_login(&self) -> &str {
        self.data.pointer("/viewer/login").and_then(Value::as_str).unwrap_or_default()
    }
}

#[async_trait]
impl GitHubBackend for GitHubMock {
    async fn search(&self, site: &SiteConfig, query: &str, max_results: Option<usize>) -> GitHubResult<Vec<Value>> {
        let viewer = self.viewer_login();
        // As GitHub's advanced search reads it: terms ANDed, with OR, NOT and groups.
        let search = Search::parse(query);
        let hits = self.nodes(site)?.filter(|n| search.matches(n, viewer));
        Ok(hits.take(max_results.unwrap_or(usize::MAX)).cloned().collect())
    }

    async fn issues(&self, site: &SiteConfig, keys: &[String]) -> GitHubResult<Vec<Value>> {
        for k in keys {
            check_key(k)?;
        }
        let nodes: Vec<&Value> = self.nodes(site)?.collect();
        // Answered as GitHub's batch is: each node says which key it was asked for.
        Ok(keys
            .iter()
            .filter_map(|k| {
                let wanted = k.to_ascii_lowercase();
                let mut node = (*nodes.iter().find(|n| key_of(n).as_deref() == Some(wanted.as_str()))?).clone();
                if let Some(fields) = node.as_object_mut() {
                    fields.insert("requestedKey".into(), k.as_str().into());
                }
                Some(node)
            })
            .collect())
    }

    async fn sub_issues(&self, site: &SiteConfig, key: &str) -> GitHubResult<Vec<Value>> {
        check_key(key)?;
        let key = key.to_ascii_lowercase();
        let parent_is = |n: &&Value| n.get("parent").and_then(key_of).as_deref() == Some(key.as_str());
        Ok(self.nodes(site)?.filter(parent_is).cloned().collect())
    }

    async fn viewer(&self, site: &SiteConfig) -> GitHubResult<Value> {
        drop(self.nodes(site)?); // fails like the other calls during a simulated outage
        Ok(self.data.get("viewer").cloned().unwrap_or(Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{DominoConfig, SEED_CONFIG};

    fn gh() -> SiteConfig {
        let cfg: DominoConfig = serde_json::from_str(SEED_CONFIG).unwrap();
        cfg.site("gh").unwrap().clone()
    }

    fn keys(nodes: &[Value]) -> Vec<String> {
        nodes.iter().filter_map(key_of).collect()
    }

    #[tokio::test]
    async fn evaluates_the_search_subset() {
        let m = GitHubMock::new(HashSet::new()).unwrap();
        let all = m.search(&gh(), "org:acme", None).await.unwrap();
        assert_eq!(all.len(), 7);
        assert_eq!(keys(&m.search(&gh(), "repo:acme/api", None).await.unwrap()), ["acme/api#12", "acme/api#15"]);
        assert_eq!(keys(&m.search(&gh(), "org:acme is:pr is:open", None).await.unwrap()), ["acme/web#45"]);
        assert_eq!(keys(&m.search(&gh(), "assignee:@me", None).await.unwrap()), ["acme/web#31", "acme/web#45"]);
        assert_eq!(m.search(&gh(), "org:acme -is:issue", Some(1)).await.unwrap().len(), 1);
        assert!(m.search(&gh(), "org:other", None).await.unwrap().is_empty());
        // As GitHub's advanced search: terms are ANDed, with OR, NOT and groups.
        assert!(m.search(&gh(), "repo:acme/api repo:acme/nope is:open", None).await.unwrap().is_empty());
        assert_eq!(m.search(&gh(), "repo:acme/api org:acme", None).await.unwrap().len(), 2);
        assert_eq!(m.search(&gh(), "repo:acme/api OR repo:acme/nope", None).await.unwrap().len(), 2);
        let plain = keys(&m.search(&gh(), "org:acme is:open", None).await.unwrap());
        assert_eq!(keys(&m.search(&gh(), "(org:acme) (is:open)", None).await.unwrap()), plain);
        let not = keys(&m.search(&gh(), "org:acme NOT repo:acme/api", None).await.unwrap());
        assert_eq!(not, keys(&m.search(&gh(), "org:acme -repo:acme/api", None).await.unwrap()));
        // A quoted phrase is one term: its OR and parenthesis are words, not syntax.
        assert_eq!(keys(&m.search(&gh(), "org:acme \"(x OR y\" is:open", None).await.unwrap()), plain);
        assert_eq!(keys(&m.search(&gh(), "(org:acme NOT) is:open", None).await.unwrap()), plain);
    }

    #[tokio::test]
    async fn reads_a_quoted_qualifier_value_as_the_value() {
        let m = GitHubMock::new(HashSet::new()).unwrap();
        for (quoted, plain) in [
            ("org:\"acme\" is:open", "org:acme is:open"),
            ("repo:\"acme/api\"", "repo:acme/api"),
            ("org:acme -repo:\"acme/api\"", "org:acme -repo:acme/api"),
        ] {
            let want = keys(&m.search(&gh(), plain, None).await.unwrap());
            assert!(!want.is_empty(), "{plain}");
            assert_eq!(keys(&m.search(&gh(), quoted, None).await.unwrap()), want, "{quoted}");
        }
    }

    #[tokio::test]
    async fn serves_issues_sub_issues_and_the_viewer() {
        let m = GitHubMock::new(HashSet::new()).unwrap();
        let got = m.issues(&gh(), &["ACME/Web#42".into(), "acme/web#999".into()]).await.unwrap();
        assert_eq!(keys(&got), ["acme/web#42"]);
        assert_eq!(got[0]["requestedKey"], "ACME/Web#42");
        assert_eq!(keys(&m.sub_issues(&gh(), "acme/web#30").await.unwrap()), ["acme/web#31", "acme/web#32"]);
        assert_eq!(m.viewer(&gh()).await.unwrap()["login"], "jonasberg");
        m.issues(&gh(), &["../x".into()]).await.unwrap_err();
    }

    #[tokio::test]
    async fn simulates_outages() {
        let m = GitHubMock::new(HashSet::from(["gh".to_owned()])).unwrap();
        assert!(m.health(&gh()).await.unwrap_err().contains("Simulated outage"));
    }
}

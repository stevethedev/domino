//! Serves fixtures/mock/github.json and evaluates a tiny GitHub search subset (kept in sync with
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
        // Like GitHub, repeated repo:/org:/user: qualifiers are ORed; everything else is ANDed.
        let is_repo_term =
            |t: &&str| ["repo:", "org:", "user:"].iter().any(|p| t.get(..p.len()).is_some_and(|h| h.eq_ignore_ascii_case(p)));
        let (repo_terms, rest): (Vec<&str>, Vec<&str>) = query.split_whitespace().partition(is_repo_term);
        let hits = self.nodes(site)?.filter(|n| {
            (repo_terms.is_empty() || repo_terms.iter().any(|t| matches_term(n, t, viewer)))
                && rest.iter().all(|t| matches_term(n, t, viewer))
        });
        Ok(hits.take(max_results.unwrap_or(usize::MAX)).cloned().collect())
    }

    async fn issues(&self, site: &SiteConfig, keys: &[String]) -> GitHubResult<Vec<Value>> {
        for k in keys {
            check_key(k)?;
        }
        let wanted: Vec<String> = keys.iter().map(|k| k.to_ascii_lowercase()).collect();
        Ok(self.nodes(site)?.filter(|n| key_of(n).is_some_and(|k| wanted.contains(&k))).cloned().collect())
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
        // GitHub ORs repeated repository qualifiers.
        assert_eq!(m.search(&gh(), "repo:acme/api repo:acme/nope is:open", None).await.unwrap().len(), 1);
        assert_eq!(m.search(&gh(), "repo:acme/api org:acme", None).await.unwrap().len(), 7);
    }

    #[tokio::test]
    async fn serves_issues_sub_issues_and_the_viewer() {
        let m = GitHubMock::new(HashSet::new()).unwrap();
        let got = m.issues(&gh(), &["acme/web#42".into(), "acme/web#999".into()]).await.unwrap();
        assert_eq!(keys(&got), ["acme/web#42"]);
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

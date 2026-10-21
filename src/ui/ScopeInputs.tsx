import { useEffect, useState, type ReactElement } from "react";
import { siteKindOf, type SiteConfig } from "../config/types";
import { combineGitHubQuery } from "../data/github/query";
import { combineJql, JQL_PRESETS, presetById } from "../data/jqlPresets";
import type { Scope } from "../data/MultiSiteLoader";
import { exampleKey, isTicketKey, normalizeKeyInput } from "../data/ticketKey";
import { saveGitHubQuery, saveQuery } from "../state/useDomino";
import { isOneOf } from "../lib/guards";
import { NumberField } from "./NumberField";

type Mode = Scope["mode"];

/** A query scope, with the GitHub search when there is one (so scopes without it look as they always did). */
const withGitHub = (scope: { mode: "jql"; jql: string }, github: string): Scope =>
  github.trim() ? { ...scope, github: github.trim() } : scope;

/** A query box; hovering shows what every selected site will run. */
function QueryField({
  id,
  label,
  value,
  onChange,
  placeholder,
  effective,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  effective: string;
}): ReactElement {
  return (
    <label className="field grow">
      <span className="field-label">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        title={`Runs:\n${effective}`}
        aria-describedby={id}
        spellCheck={false}
      />
      <span id={id} className="sr-only">
        Combined with each site's filter. Runs: {effective}
      </span>
    </label>
  );
}
const MODES: readonly Mode[] = ["jql", "epic", "seed"];
const isMode = isOneOf(MODES);

export function ScopeInputs({
  sites,
  scope,
  onApply,
}: {
  sites: SiteConfig[]; // selected sites
  scope: Scope;
  onApply: (s: Scope) => void;
}): ReactElement {
  const [mode, setMode] = useState<Mode>(scope.mode);
  const [jql, setJql] = useState(scope.mode === "jql" ? scope.jql : "");
  const [github, setGitHub] = useState(scope.mode === "jql" ? (scope.github ?? "") : "");
  const [siteId, setSiteId] = useState(scope.mode !== "jql" ? scope.siteId : (sites[0]?.id ?? ""));
  const [key, setKey] = useState(scope.mode !== "jql" ? scope.key : "");
  const [depth, setDepth] = useState(scope.mode === "seed" ? scope.depth : 2);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sites.some((s) => s.id === siteId)) setSiteId(sites[0]?.id ?? "");
  }, [sites, siteId]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (mode === "jql") {
      setError(null);
      saveQuery(jql.trim());
      saveGitHubQuery(github.trim());
      onApply(withGitHub({ mode, jql: jql.trim() }, github));
      return;
    }
    if (!keySite) {
      setError("Select a site first");
      return;
    }
    const k = normalizeKeyInput(keySite, key);
    if (!isTicketKey(keySite, k)) {
      setError(
        siteKindOf(keySite) === "github"
          ? "Enter a key like acme/web#12, or paste the issue's URL from this site"
          : "Enter a ticket key like CORE-1",
      );
      return;
    }
    setError(null);
    onApply(mode === "epic" ? { mode, siteId, key: k } : { mode, siteId, key: k, depth });
  };

  const keySite = sites.find((s) => s.id === siteId);
  const hasJira = sites.some((s) => siteKindOf(s) === "jira");
  const hasGitHub = sites.some((s) => siteKindOf(s) === "github");

  /** What each selected site will actually run: its "Always filter by" AND the query box for its kind. */
  const effective = sites
    .map((s) => {
      const q = siteKindOf(s) === "github" ? combineGitHubQuery(s.baseJql ?? "", github) : combineJql(s.baseJql ?? "", jql.trim());
      return `${s.label}: ${q || "(nothing to load)"}`;
    })
    .join("\n");
  const activePreset = JQL_PRESETS.find((p) => p.jql === jql.trim())?.id ?? "";

  const choosePreset = (id: string): void => {
    if (!id) return;
    const q = presetById(id).jql;
    setJql(q);
    saveQuery(q);
    onApply(withGitHub({ mode: "jql", jql: q }, github));
  };

  return (
    <form className="scope" onSubmit={submit} aria-label="Scope">
      <label className="field">
        <span className="field-label">Mode</span>
        <select
          value={mode}
          onChange={(e) => {
            if (isMode(e.target.value)) setMode(e.target.value);
          }}
        >
          <option value="jql">{hasGitHub ? "Query" : "JQL"}</option>
          <option value="epic">Epic</option>
          <option value="seed">Seed + depth</option>
        </select>
      </label>

      {mode === "jql" ? (
        <>
          {(hasJira || !hasGitHub) && (
            <QueryField
              id="query-desc"
              label={hasGitHub ? "JQL" : "Query"}
              value={jql}
              onChange={setJql}
              placeholder="JQL, e.g. statusCategory != Done"
              effective={effective}
            />
          )}
          {hasGitHub && (
            <QueryField
              id="github-query-desc"
              label="GitHub search"
              value={github}
              onChange={setGitHub}
              placeholder="e.g. is:open assignee:@me"
              effective={effective}
            />
          )}
          {hasJira && (
            <label className="field">
              <span className="sr-only">Query presets</span>
              <select
                value={activePreset}
                onChange={(e) => {
                  choosePreset(e.target.value);
                }}
                aria-label="Query presets"
              >
                <option value="" disabled>
                  Presets…
                </option>
                {JQL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          {sites.length > 1 && (
            <label className="field">
              <span className="field-label">Site</span>
              <select
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                }}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">
              {mode === "epic" ? (keySite?.kind === "github" ? "Parent issue" : "Epic key") : "Ticket key"}
            </span>
            <input
              type="text"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder={keySite?.kind === "github" ? exampleKey(keySite) : mode === "epic" ? "CORE-1" : "CORE-11"}
              aria-invalid={!!error}
              aria-describedby={error ? "scope-error" : undefined}
              spellCheck={false}
              size={keySite?.kind === "github" ? 16 : 10}
            />
          </label>
          {mode === "seed" && (
            <label className="field">
              <span className="field-label">Depth</span>
              {/* Keeps what you type (clearing it to type "3" doesn't jump to 13); only 1-5 is used. */}
              <NumberField min={1} max={5} step={1} integer value={depth} onCommit={setDepth} />
            </label>
          )}
        </>
      )}
      <button type="submit" className="primary">
        Load
      </button>
      {error && (
        <span id="scope-error" role="alert" className="field-error">
          {error}
        </span>
      )}
    </form>
  );
}

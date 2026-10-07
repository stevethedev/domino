import { NumberField } from "./NumberField";
import { useEffect, useState, type ReactElement } from "react";
import type { SiteConfig } from "../config/types";
import { combineJql, JQL_PRESETS, presetById } from "../data/jqlPresets";
import { ISSUE_KEY_RE, type Scope } from "../data/MultiSiteLoader";
import { saveQuery } from "../state/useDomino";
import { isOneOf } from "../lib/guards";

type Mode = Scope["mode"];
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
      onApply({ mode, jql: jql.trim() });
      return;
    }
    const k = key.trim().toUpperCase();
    if (!ISSUE_KEY_RE.test(k)) {
      setError("Enter a ticket key like CORE-1");
      return;
    }
    if (!siteId) {
      setError("Select a site first");
      return;
    }
    setError(null);
    onApply(mode === "epic" ? { mode, siteId, key: k } : { mode, siteId, key: k, depth });
  };

  /** What each selected site will actually run: its "Always filter by" JQL AND this query. */
  const effective = sites.map((s) => `${s.label}: ${combineJql(s.baseJql ?? "", jql.trim()) || "(nothing to load)"}`).join("\n");
  const activePreset = JQL_PRESETS.find((p) => p.jql === jql.trim())?.id ?? "";

  const choosePreset = (id: string): void => {
    if (!id) return;
    const q = presetById(id).jql;
    setJql(q);
    saveQuery(q);
    onApply({ mode: "jql", jql: q });
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
          <option value="jql">JQL</option>
          <option value="epic">Epic</option>
          <option value="seed">Seed + depth</option>
        </select>
      </label>

      {mode === "jql" ? (
        <>
          <label className="field grow">
            <span className="field-label">Query</span>
            <input
              type="text"
              value={jql}
              onChange={(e) => {
                setJql(e.target.value);
              }}
              placeholder="JQL, e.g. statusCategory != Done"
              title={`Runs:\n${effective}`}
              aria-describedby="query-desc"
              spellCheck={false}
            />
            <span id="query-desc" className="sr-only">
              Combined with each site's filter. Runs: {effective}
            </span>
          </label>
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
            <span className="field-label">{mode === "epic" ? "Epic key" : "Ticket key"}</span>
            <input
              type="text"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder={mode === "epic" ? "CORE-1" : "CORE-11"}
              aria-invalid={!!error}
              aria-describedby={error ? "scope-error" : undefined}
              spellCheck={false}
              size={10}
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

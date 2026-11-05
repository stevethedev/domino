import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { siteKindOf, type SiteConfig } from "../config/types";
import { combineGitHubQuery } from "../data/github/query";
import { combineJql, JQL_PRESETS, presetById } from "../data/jqlPresets";
import type { Scope } from "../data/MultiSiteLoader";
import { exampleKey, isTicketKey, normalizeKeyInput } from "../data/ticketKey";
import { saveGitHubQuery, saveQuery } from "../state/useDomino";
import { isOneOf } from "../lib/guards";
import { NumberField } from "./NumberField";
import { useDetailsMenu } from "./useDetailsMenu";
import { announce } from "./Announcer";

type Mode = Scope["mode"];

/** A query scope, with the GitHub search when there is one (so scopes without it look as they always did). */
const withGitHub = (scope: { mode: "jql"; jql: string }, github: string): Scope =>
  github.trim() ? { ...scope, github: github.trim() } : scope;

/** What a key press in the query editor does: Enter loads (Shift+Enter is a new line), Esc cancels. */
export function editorKeyAction(e: Readonly<{ key: string; shiftKey: boolean; isComposing: boolean }>): "load" | "cancel" | null {
  // While an input method composes text, its keys are its own: Enter picks a candidate, Esc closes the list.
  if (e.isComposing) return null;
  if (e.key === "Escape") return "cancel";
  if (e.key === "Enter" && !e.shiftKey) return "load";
  return null;
}

/**
 * How far right to move the opened query editor so it starts inside the top bar. It grows leftward
 * from the trigger, which only fits while the trigger sits far right; when the top bar wraps, the
 * trigger starts a row and the editor would run off the left edge.
 */
export const editorShift = (e: Readonly<{ editorLeft: number; minLeft: number }>): number => Math.max(0, e.minLeft - e.editorLeft);

/** One search box in the query editor, described by what every selected site will run. */
function QueryBox({
  label,
  value,
  onChange,
  placeholder,
  runsId,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  runsId: string;
  autoFocus: boolean;
}): ReactElement {
  return (
    <label className="query-box">
      <span className="field-label">{label}</span>
      <textarea
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-describedby={runsId}
        spellCheck={false}
        rows={3}
        // Focused when the editor opens (see onToggle), not on every render.
        data-autofocus={autoFocus || undefined}
      />
    </label>
  );
}

/** Focus after these inputs load a scope: back on the editor's trigger if the editor loaded it, else on Load. */
export const refocusAfterLoad = (f: Readonly<{ inEditor: boolean; inForm: boolean }>): "trigger" | "load" | null =>
  f.inEditor ? "trigger" : f.inForm ? "load" : null;

/**
 * Set when these inputs load a scope: App remounts them for the new scope (see its `key`), and the
 * new mount puts focus back (see refocusAfterLoad) so it isn't lost to the page.
 */
let refocusOnMount: "trigger" | "load" | null = null;

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
  const editor = useDetailsMenu();
  const runsId = useId();
  const presetsId = useId();

  useEffect(() => {
    if (!sites.some((s) => s.id === siteId)) setSiteId(sites[0]?.id ?? "");
  }, [sites, siteId]);

  const form = useRef<HTMLFormElement>(null);
  const loadButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target = refocusOnMount;
    if (!target) return;
    refocusOnMount = null;
    (target === "trigger" ? editor.ref.current?.querySelector("summary") : loadButton.current)?.focus();
  }, [editor.ref]);

  /** Applies a scope; focus survives the remount it causes (see refocusOnMount). */
  const apply = (q: Scope): void => {
    const active = document.activeElement;
    refocusOnMount = refocusAfterLoad({
      inEditor: editor.ref.current?.contains(active) ?? false,
      inForm: form.current?.contains(active) ?? false,
    });
    onApply(q);
    // The same scope again doesn't remount: don't let the flag reach some later, unrelated mount.
    requestAnimationFrame(() => {
      refocusOnMount = null;
    });
  };

  /** Loads from the editor: closes it, and focus survives the remount. */
  const loadQuery = (q: Scope): void => {
    editor.close();
    apply(q);
  };

  /** Shown beside the field, and said once per Load that fails (not each time it renders). */
  const fail = (message: string): void => {
    setError(message);
    announce(message, { assertive: true, source: "scope" });
  };
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (mode === "jql") {
      setError(null);
      saveQuery(jql.trim());
      saveGitHubQuery(github.trim());
      loadQuery(withGitHub({ mode, jql: jql.trim() }, github));
      return;
    }
    if (!keySite) {
      fail("Select a site first");
      return;
    }
    const k = normalizeKeyInput(keySite, key);
    if (!isTicketKey(keySite, k)) {
      fail(
        siteKindOf(keySite) === "github"
          ? "Enter a key like acme/web#12, or paste the issue's URL from this site"
          : "Enter a ticket key like CORE-1",
      );
      return;
    }
    setError(null);
    apply(mode === "epic" ? { mode, siteId, key: k } : { mode, siteId, key: k, depth });
  };

  const keySite = sites.find((s) => s.id === siteId);
  const hasJira = sites.some((s) => siteKindOf(s) === "jira");
  const hasGitHub = sites.some((s) => siteKindOf(s) === "github");

  /** What each selected site will actually run: its "Always filter by" AND the query box for its kind. */
  const effective = sites.map((s) => {
    const q = siteKindOf(s) === "github" ? combineGitHubQuery(s.baseJql ?? "", github) : combineJql(s.baseJql ?? "", jql.trim());
    return `${s.label}: ${q || "(nothing to load)"}`;
  });
  const summaryText = [hasJira || !hasGitHub ? jql.trim() : "", hasGitHub ? github.trim() : ""].filter(Boolean).join(" · ");

  /** Puts back the query that's loaded and closes the editor, focus back on its button. */
  const cancel = (): void => {
    setJql(scope.mode === "jql" ? scope.jql : "");
    setGitHub(scope.mode === "jql" ? (scope.github ?? "") : "");
    editor.close();
  };

  const choosePreset = (id: string): void => {
    if (!id) return;
    const q = presetById(id).jql;
    setJql(q);
    saveQuery(q);
    saveGitHubQuery(github.trim()); // it runs too, so a restart brings back what was run
    loadQuery(withGitHub({ mode: "jql", jql: q }, github));
  };

  return (
    <form className="scope" ref={form} onSubmit={submit} aria-label="Scope">
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
        <details
          className="query"
          ref={editor.ref}
          onToggle={(e) => {
            if (!e.currentTarget.open) return;
            const panel = e.currentTarget.querySelector<HTMLElement>(".query-editor");
            const bar = e.currentTarget.closest(".topbar");
            if (panel && bar) {
              panel.style.translate = "";
              const minLeft = bar.getBoundingClientRect().left + parseFloat(getComputedStyle(bar).paddingLeft);
              const shift = editorShift({ editorLeft: panel.getBoundingClientRect().left, minLeft });
              if (shift > 0) panel.style.translate = `${shift}px`;
            }
            e.currentTarget.querySelector<HTMLElement>("[data-autofocus]")?.focus();
          }}
          onKeyDown={(e) => {
            const action = editorKeyAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing });
            if (action === "cancel" && editor.ref.current?.open) {
              e.preventDefault();
              cancel();
            } else if (action === "load" && e.target instanceof HTMLTextAreaElement) {
              e.preventDefault();
              e.currentTarget.closest("form")?.requestSubmit();
            }
          }}
        >
          <summary className="query-trigger">
            <span className="field-label">{hasGitHub && !hasJira ? "GitHub search" : "Query"}</span>
            <span className={summaryText ? "query-text" : "query-text muted"}>{summaryText || "Everything the site filters allow"}</span>
          </summary>
          <div className="query-editor">
            {(hasJira || !hasGitHub) && (
              <QueryBox
                label={hasGitHub ? "JQL" : "Query"}
                value={jql}
                onChange={setJql}
                placeholder="JQL, e.g. statusCategory != Done"
                runsId={runsId}
                autoFocus
              />
            )}
            {hasGitHub && (
              <QueryBox
                label="GitHub search"
                value={github}
                onChange={setGitHub}
                placeholder="e.g. is:open assignee:@me"
                runsId={runsId}
                autoFocus={!hasJira}
              />
            )}
            <div id={runsId} className="query-runs">
              <span className="field-label">Combined with each site's filter, this runs:</span>
              {effective.map((line) => (
                <code key={line}>{line}</code>
              ))}
            </div>
            {hasJira && (
              <>
                <span className="field-label" id={presetsId}>
                  Presets
                </span>
                <ul className="query-presets" aria-labelledby={presetsId}>
                  {JQL_PRESETS.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="link-btn"
                        aria-current={p.jql === jql.trim() || undefined}
                        onClick={() => {
                          choosePreset(p.id);
                        }}
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="query-actions">
              <button type="button" onClick={cancel}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Load
              </button>
            </div>
          </div>
        </details>
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
      <button type="submit" className="primary" ref={loadButton}>
        Load
      </button>
      {error && (
        <span id="scope-error" className="field-error">
          {error}
        </span>
      )}
    </form>
  );
}

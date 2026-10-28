import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import type { ConfigStore } from "../../config/ConfigStore";
import { validateSite } from "../../config/schema";
import {
  API_TOKEN_URL,
  applyUrl,
  chooseKind,
  draftChanged,
  gitHubTokenUrl,
  parseJiraUrl,
  suggestedSecretRef,
} from "../../config/siteDraft";
import { siteKindOf, type BackendKind, type SiteConfig } from "../../config/types";
import { errorMessage } from "../../data/errors";
import { overlappingSites } from "../../data/siteScope";
import { openExternal } from "../../platform";
import { Icon } from "../Icon";
import { prefersReducedMotion } from "../../lib/motion";

export type SiteFormResult = { site: SiteConfig; isDefault: boolean; token: string; test: boolean };

const PALETTE = ["#7c3aed", "#c2410c", "#0f766e", "#be185d", "#1d4ed8", "#4d7c0f"];
const ADVANCED_FIELDS = new Set(["id", "auth.secretRef", "color"]);

export function blankSite(existing: readonly SiteConfig[]): SiteConfig {
  return {
    id: "",
    label: "",
    baseUrl: "",
    auth: { type: "apiToken", email: "", secretRef: "" },
    color: PALETTE[existing.length % PALETTE.length],
    enabled: true,
    baseJql: "",
  };
}

/** Trims, turns any pasted Jira link into its origin, and drops an empty default JQL. */
function normalize(s: SiteConfig): SiteConfig {
  const out: SiteConfig = { ...s, label: s.label.trim(), baseUrl: parseJiraUrl(s.baseUrl)?.origin ?? s.baseUrl.trim() };
  if (!out.baseJql?.trim()) delete out.baseJql;
  return out;
}

export function SiteForm({
  initial,
  initialDefault,
  others,
  isNew,
  store,
  backend,
  onSwitchToLive,
  onSubmit,
  onCancel,
  onDismiss,
  onDirty,
}: {
  initial: SiteConfig;
  initialDefault: boolean;
  others: readonly SiteConfig[];
  isNew: boolean;
  store: ConfigStore;
  backend: BackendKind;
  onSwitchToLive: () => void;
  onSubmit: (r: SiteFormResult) => Promise<void>;
  /** The Cancel button: a deliberate choice, so it closes at once. */
  onCancel: () => void;
  /** Esc: closes the form, after a confirm when it has unsaved changes (the caller asks). */
  onDismiss: () => void;
  /** Reports whether the form holds anything closing it would lose. */
  onDirty: (dirty: boolean) => void;
}): ReactElement {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<SiteConfig>(initial);
  const [auto, setAuto] = useState({ id: initial.id, label: initial.label });
  const [isDefault, setIsDefault] = useState(initialDefault);
  const [token, setToken] = useState("");
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [secretSet, setSecretSet] = useState<boolean | null>(null);
  const [oauthConnected, setOauthConnected] = useState<boolean | null>(null);

  // A token pasted for one kind of site never goes to the other: switching kind (by the radios or a
  // pasted github.com link) drops it.
  const kind = siteKindOf(draft);
  useEffect(() => {
    setToken("");
  }, [kind]);

  const dirty = draftChanged({ initial, draft, initialDefault, isDefault, token });
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => (): void => {
      onDirty(false); // closed: nothing left to lose
    },
    [onDirty],
  );

  const takenIds = useMemo(() => others.map((o) => o.id), [others]);
  const secretRef = draft.auth.type === "oauth3lo" ? "" : draft.auth.secretRef;
  const github = siteKindOf(draft) === "github";

  // Other sites on this address whose filters could load the same tickets: those show twice, once per site.
  const overlaps = useMemo(() => overlappingSites(normalize(draft), others), [draft, others]);

  const errors = useMemo(() => {
    const e = validateSite(normalize(draft), others);
    if (draft.auth.type !== "oauth3lo" && !token && secretSet === false) e.token = "Paste a token";
    return e;
  }, [draft, others, token, secretSet]);
  const hasErrors = Object.keys(errors).length > 0;
  const show = (field: string): string | undefined => (submitted || touched.has(field) ? errors[field] : undefined);
  const touch = (field: string): void => {
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));
  };

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
      setSecretSet(false);
      return;
    }
    let live = true;
    store.secretStatus(secretRef).then(
      (v) => {
        if (live) setSecretSet(v);
      },
      () => {
        if (live) setSecretSet(null);
      },
    );
    return (): void => {
      live = false;
    };
  }, [secretRef, store]);

  useEffect(() => {
    if (draft.auth.type !== "oauth3lo") return;
    store.oauthStatus().then(
      (s) => {
        setOauthConnected(s.connected);
      },
      () => {
        setOauthConnected(null);
      },
    );
  }, [draft.auth.type, store]);

  const update = (patch: Partial<SiteConfig>): void => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const updateAuth = (patch: { email?: string; secretRef?: string }): void => {
    setDraft((d) => {
      if (d.auth.type === "apiToken") return { ...d, auth: { ...d.auth, ...patch } };
      if (d.auth.type === "githubToken" && patch.secretRef !== undefined) return { ...d, auth: { ...d.auth, secretRef: patch.secretRef } };
      return d;
    });
  };

  /** Save failures are shown in `saveError`, so callers need not handle the promise. */
  const submit = async (test: boolean): Promise<void> => {
    setSubmitted(true);
    if (hasErrors) {
      const first = Object.keys(errors)[0];
      if (ADVANCED_FIELDS.has(first)) setAdvancedOpen(true);
      requestAnimationFrame(() => document.getElementById(`${uid}-${first}`)?.focus());
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit({ site: normalize(draft), isDefault, token, test });
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  };

  const errId = (name: string): string => `${uid}-${name}-err`;
  const hintId = (name: string): string => `${uid}-${name}-hint`;
  const aria = (
    name: string,
    hint = false,
  ): { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined; onBlur: () => void } => ({
    id: `${uid}-${name}`,
    "aria-invalid": !!show(name),
    "aria-describedby": show(name) ? errId(name) : hint ? hintId(name) : undefined,
    onBlur: () => {
      touch(name);
    },
  });
  const field = (name: string, label: React.ReactNode, input: React.ReactNode, hint?: React.ReactNode, wide = false): ReactElement => {
    const err = show(name);
    return (
      <div className={`form-field${wide ? " form-span" : ""}`}>
        <label htmlFor={`${uid}-${name}`}>{label}</label>
        {input}
        {err ? (
          <span className="field-error" id={errId(name)} role="alert">
            {err}
          </span>
        ) : (
          hint && (
            <span className="hint" id={hintId(name)}>
              {hint}
            </span>
          )
        )}
      </div>
    );
  };

  const parsed = parseJiraUrl(draft.baseUrl);
  const urlHint =
    parsed && parsed.origin !== draft.baseUrl.trim().replace(/\/+$/, "") ? (
      <>
        Will use <span className="mono">{parsed.origin}</span>
      </>
    ) : github ? (
      <>https://github.com, or your GitHub Enterprise Server address</>
    ) : (
      <>Paste any link from the site, e.g. a ticket like https://your-team.atlassian.net/browse/ABC-1</>
    );

  return (
    <form
      ref={formRef}
      className="site-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
      noValidate
      aria-labelledby={`${uid}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation(); // close the form, not the whole dialog
          e.preventDefault();
          onDismiss();
        }
      }}
    >
      <h3 id={`${uid}-title`}>{isNew ? "Add a site" : `Edit ${initial.label}`}</h3>

      {backend === "mock" && (
        <div className="notice" role="note">
          Domino is showing <strong>mock data</strong>, so a real site won't load yet.{" "}
          <button type="button" className="link-btn" onClick={onSwitchToLive}>
            Switch to Live Jira
          </button>
        </div>
      )}

      <div className="form-grid">
        {isNew && (
          <fieldset className="form-field form-span">
            <legend>Kind of site</legend>
            <div className="radio-row">
              <label className="check">
                <input
                  type="radio"
                  name={`${uid}-kind`}
                  checked={!github}
                  onChange={() => {
                    const res = chooseKind(draft, "jira", takenIds, auto);
                    setDraft(res.draft);
                    setAuto(res.auto);
                  }}
                />
                Jira
              </label>
              <label className="check">
                <input
                  type="radio"
                  name={`${uid}-kind`}
                  checked={github}
                  onChange={() => {
                    const res = chooseKind(draft, "github", takenIds, auto);
                    setDraft(res.draft);
                    setAuto(res.auto);
                  }}
                />
                GitHub (issues and pull requests)
              </label>
            </div>
          </fieldset>
        )}
        {field(
          "baseUrl",
          <>
            {github ? "GitHub URL" : "Jira URL"} <span aria-hidden="true">*</span>
          </>,
          <input
            {...aria("baseUrl", true)}
            type="url"
            inputMode="url"
            value={draft.baseUrl}
            placeholder={github ? "https://github.com" : "https://your-team.atlassian.net"}
            onChange={(e) => {
              const res = applyUrl(draft, e.target.value, takenIds, auto);
              setDraft(isNew ? res.draft : { ...draft, baseUrl: e.target.value });
              if (isNew) setAuto(res.auto);
            }}
            onPaste={() => {
              touch("baseUrl");
            }}
            spellCheck={false}
            required
          />,
          urlHint,
          true,
        )}
        {field(
          "label",
          "Name",
          <input
            {...aria("label", true)}
            value={draft.label}
            onChange={(e) => {
              update({ label: e.target.value });
            }}
            placeholder="Shown on cards and badges"
          />,
        )}
        {field(
          "baseJql",
          github ? "Always filter by (GitHub search)" : "Always filter by (JQL)",
          <input
            {...aria("baseJql", true)}
            value={draft.baseJql ?? ""}
            onChange={(e) => {
              update({ baseJql: e.target.value });
            }}
            placeholder={github ? "org:acme" : "project = ABC"}
            spellCheck={false}
          />,
          overlaps.length ? (
            <span className="hint-warn">
              Can match the same tickets as {overlaps.map((o) => o.label).join(", ")}, on the same address: those show twice, once per site.
            </span>
          ) : github ? (
            "Added to every search on this site, on top of the GitHub search in the top bar. Usually org: or repo:; linked tickets outside those load on another site at this address that covers them, or stay unloaded."
          ) : (
            "Applied to every search on this site, on top of the query in the top bar. Usually a project."
          ),
        )}
        {!github && (
          <fieldset className="form-field form-span">
            <legend>How Domino signs in</legend>
            <div className="radio-row">
              <label className="check">
                <input
                  type="radio"
                  name={`${uid}-auth`}
                  checked={draft.auth.type === "apiToken"}
                  onChange={() => {
                    update({ auth: { type: "apiToken", email: "", secretRef: suggestedSecretRef(draft.id) } });
                  }}
                />
                Email + API token
              </label>
              <label className="check">
                <input
                  type="radio"
                  name={`${uid}-auth`}
                  checked={draft.auth.type === "oauth3lo"}
                  onChange={() => {
                    update({ auth: { type: "oauth3lo" } });
                  }}
                />
                Atlassian sign-in (OAuth)
              </label>
            </div>
          </fieldset>
        )}

        {draft.auth.type === "githubToken" ? (
          field(
            "token",
            <>Personal access token {secretSet ? <span className="muted small">(stored)</span> : <span aria-hidden="true">*</span>}</>,
            <input
              {...aria("token", true)}
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
              }}
              placeholder={secretSet ? "Stored in your keychain. Paste to replace." : "Paste your token"}
            />,
            <>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  openExternal(gitHubTokenUrl(parsed?.origin ?? "https://github.com"));
                }}
              >
                Create a token on GitHub <Icon name="external" />
              </button>{" "}
              Read-only access is enough: Issues, Pull requests and Metadata. Saved to your OS keychain, never shown again.
            </>,
            true,
          )
        ) : draft.auth.type === "apiToken" ? (
          <>
            {field(
              "auth.email",
              <>
                Atlassian account email <span aria-hidden="true">*</span>
              </>,
              <input
                {...aria("auth.email")}
                type="email"
                autoComplete="email"
                value={draft.auth.email}
                onChange={(e) => {
                  updateAuth({ email: e.target.value });
                }}
              />,
            )}
            {field(
              "token",
              <>API token {secretSet ? <span className="muted small">(stored)</span> : <span aria-hidden="true">*</span>}</>,
              <input
                {...aria("token", true)}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                }}
                placeholder={secretSet ? "Stored in your keychain. Paste to replace." : "Paste your token"}
              />,
              <>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    openExternal(API_TOKEN_URL);
                  }}
                >
                  Create a token at id.atlassian.com <Icon name="external" />
                </button>{" "}
                Saved to your OS keychain, never shown again.
              </>,
            )}
          </>
        ) : (
          <p className="hint form-span">
            {oauthConnected
              ? "✓ You're signed in with Atlassian. This site will use that sign-in."
              : "Uses one Atlassian sign-in for all OAuth sites. Set it up under Data source → OAuth app (above), then click Connect."}
          </p>
        )}

        <label className="check form-span">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => {
              setIsDefault(e.target.checked);
            }}
          />
          Load this site by default
        </label>
      </div>

      <details
        className="advanced"
        open={advancedOpen}
        onToggle={(e) => {
          setAdvancedOpen(e.currentTarget.open);
        }}
      >
        <summary>Advanced</summary>
        <div className="form-grid">
          {field(
            "id",
            "Site id",
            <input
              {...aria("id", true)}
              value={draft.id}
              readOnly={!isNew}
              onChange={(e) => {
                update({ id: e.target.value.toLowerCase() });
              }}
              spellCheck={false}
            />,
            isNew ? "Filled in from the URL. Used internally; can't be changed later." : "Ids can't be changed.",
          )}
          {draft.auth.type !== "oauth3lo" &&
            field(
              "auth.secretRef",
              "Keychain entry name",
              <input
                {...aria("auth.secretRef", true)}
                value={secretRef}
                onChange={(e) => {
                  updateAuth({ secretRef: e.target.value.toUpperCase() });
                }}
                spellCheck={false}
              />,
              "An environment variable with this name overrides the keychain.",
            )}
          {field(
            "color",
            "Badge color",
            <span className="color-row">
              <input
                {...aria("color")}
                type="color"
                value={draft.color}
                onChange={(e) => {
                  update({ color: e.target.value });
                }}
              />
              <span className="chip" style={{ "--site": draft.color }}>
                <span className="dot" aria-hidden="true" />
                {draft.label || "Preview"}
              </span>
            </span>,
          )}
          <label className="check">
            <input
              type="checkbox"
              role="switch"
              checked={draft.enabled}
              onChange={(e) => {
                update({ enabled: e.target.checked });
              }}
            />
            Enabled
          </label>
        </div>
      </details>

      {saveError && (
        <p className="field-error" role="alert">
          Could not save: {saveError}
        </p>
      )}
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void submit(false);
          }}
          disabled={saving}
        >
          {isNew ? "Add without testing" : "Save"}
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : isNew ? "Add & test connection" : "Save & test"}
        </button>
      </div>
    </form>
  );
}

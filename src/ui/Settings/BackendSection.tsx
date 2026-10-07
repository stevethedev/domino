import { useCallback, useEffect, useId, useState, type ReactElement } from "react";
import type { BackendKind, DominoConfig, OAuthStatus } from "../../config/types";
import { errorMessage } from "../../data/errors";
import type { Domino } from "../../state/useDomino";

const CLIENT_ID_REF = "DOMINO_OAUTH_CLIENT_ID";
const CLIENT_SECRET_REF = "DOMINO_OAUTH_CLIENT_SECRET";

/** Data source switch plus the (write-only) OAuth app credentials and Connect flow. */
export function BackendSection({ domino, config }: { domino: Domino; config: DominoConfig }): ReactElement {
  const uid = useId();
  const store = domino.store;
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "connect" | "disconnect" | "backend" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const oauthSites = config.sites.filter((s) => s.auth.type === "oauth3lo").map((s) => s.label);
  const hasOAuthSites = oauthSites.length > 0;
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = useCallback(() => {
    store.oauthStatus().then(setStatus, () => {
      setStatus(null);
    });
  }, [store]);
  useEffect(refresh, [refresh]);

  /** Runs a backend action; its failure is shown in `message`, so callers need not handle the promise. */
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string | undefined>): Promise<void> => {
    setBusy(kind);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: "ok", text });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const setBackend = (backend: BackendKind): void => {
    void run("backend", async () => {
      await domino.saveConfig({ ...config, backend });
    });
  };

  const saveApp = (): void => {
    void run("save", async () => {
      if (clientId.trim()) await store.setSecret(CLIENT_ID_REF, clientId.trim());
      if (clientSecret) await store.setSecret(CLIENT_SECRET_REF, clientSecret);
      setClientId("");
      setClientSecret("");
      return "OAuth app credentials stored in the keychain.";
    });
  };

  const connect = (): void => {
    void run("connect", async () => {
      let sites: string[];
      try {
        sites = await store.oauthConnect();
      } catch (e) {
        if (errorMessage(e) === "Sign-in cancelled") return "Sign-in cancelled."; // asked for, not a failure
        throw e;
      }
      await domino.refreshConfig(); // pick up discovered cloudIds
      return `Connected. Your account can access ${sites.length} site${sites.length === 1 ? "" : "s"}: ${sites.join(", ") || "none"}.`;
    });
  };

  return (
    <section className="backend-section" aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>Data source</h3>
      <fieldset className="radio-row">
        <legend className="sr-only">Data source</legend>
        <label className="check">
          <input
            type="radio"
            name={`${uid}-backend`}
            checked={config.backend === "mock"}
            onChange={() => {
              setBackend("mock");
            }}
            disabled={busy === "backend"}
          />
          Mock data <span className="muted small">(bundled fixtures)</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name={`${uid}-backend`}
            checked={config.backend === "jira"}
            onChange={() => {
              setBackend("jira");
            }}
            disabled={busy === "backend"}
          />
          Live Jira <span className="muted small">(REST API v3)</span>
        </label>
      </fieldset>

      <details className="oauth-app">
        <summary>
          OAuth 2.0 (3LO) app{" "}
          <span className={`health ${status?.connected ? "health-ok" : "health-unknown"}`}>
            {status === null
              ? ""
              : status.connected
                ? "✓ Connected"
                : hasOAuthSites
                  ? status.appConfigured
                    ? "Not connected"
                    : "Not configured (needed by your OAuth sites)"
                  : "Not configured"}
          </span>
        </summary>
        <p className="hint">
          Needed only for sites that use OAuth. Create the app in the Atlassian developer console with callback URL{" "}
          <code>http://127.0.0.1:53682/callback</code> (see the README). The values are stored in the OS keychain and never shown again.
        </p>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor={`${uid}-cid`}>Client ID</label>
            <input
              id={`${uid}-cid`}
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder={status?.appConfigured ? "Stored. Type to replace." : ""}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${uid}-csec`}>Client secret</label>
            <input
              id={`${uid}-csec`}
              type="password"
              value={clientSecret}
              onChange={(e) => {
                setClientSecret(e.target.value);
              }}
              autoComplete="off"
              placeholder={status?.appConfigured ? "Stored. Type to replace." : ""}
            />
          </div>
        </div>
        <div className="form-actions">
          <button type="button" onClick={saveApp} disabled={busy !== null || (!clientId.trim() && !clientSecret)}>
            {busy === "save" ? "Saving…" : "Save app credentials"}
          </button>
          {status?.connected ? (
            <button
              type="button"
              onClick={() => {
                setConfirmDisconnect(true);
              }}
              disabled={busy !== null || confirmDisconnect}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : null}
          {busy === "connect" ? (
            <button
              type="button"
              onClick={() => {
                store.oauthCancel().catch(() => undefined); // the waiting connect reports the outcome
              }}
            >
              Cancel sign-in
            </button>
          ) : (
            <button type="button" className="primary" onClick={connect} disabled={busy !== null || !status?.appConfigured}>
              {status?.connected ? "Reconnect" : "Connect with Atlassian"}
            </button>
          )}
        </div>
        {busy === "connect" && (
          <p className="hint" role="status">
            Sign in to Atlassian in the browser window that opened. Domino waits up to 5 minutes.
          </p>
        )}
        {confirmDisconnect && (
          <div className="banner warn actionable" role="alertdialog" aria-label="Disconnect from Atlassian">
            <div className="banner-text">
              Disconnect from Atlassian?{" "}
              {hasOAuthSites
                ? `${oauthSites.join(", ")} will stop loading until you connect again, and ${oauthSites.length === 1 ? "its" : "their"} cached tickets are discarded.`
                : "No site uses it right now."}
            </div>
            <div className="banner-actions">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setConfirmDisconnect(false);
                  void run("disconnect", async () => {
                    await store.oauthDisconnect();
                    return "Disconnected.";
                  });
                }}
              >
                Disconnect
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setConfirmDisconnect(false);
                }}
              >
                Keep connected
              </button>
            </div>
          </div>
        )}
      </details>
      {message && (
        <p className={message.kind === "error" ? "field-error" : "hint"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </section>
  );
}

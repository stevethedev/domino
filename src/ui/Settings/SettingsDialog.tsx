import { useEffect, useRef, useState, type ReactElement } from "react";
import type { SiteConfig } from "../../config/types";
import { errorMessage } from "../../data/errors";
import type { Domino } from "../../state/useDomino";
import type { RefreshMinutes } from "../../state/refresh";
import { AutoRefreshField } from "../Refresh";
import type { AppUpdate } from "../../state/useAppUpdate";
import { AppUpdatesSection } from "./AppUpdatesSection";
import { BackendSection } from "./BackendSection";
import { CachedTicketsSection } from "./CachedTicketsSection";
import { blankSite, SiteForm, type SiteFormResult } from "./SiteForm";
import { SiteRow } from "./SiteRow";
import { Icon } from "../Icon";

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

export function SettingsDialog({
  domino,
  open,
  onClose,
  refreshMinutes,
  onRefreshMinutes,
  notifyUnblocked,
  onNotifyUnblocked,
  updates,
  autoUpdateCheck,
  onAutoUpdateCheck,
}: {
  domino: Domino;
  open: boolean;
  onClose: () => void;
  refreshMinutes: RefreshMinutes;
  onRefreshMinutes: (m: RefreshMinutes) => void;
  notifyUnblocked: boolean;
  onNotifyUnblocked: (on: boolean) => void;
  updates: AppUpdate;
  autoUpdateCheck: boolean;
  onAutoUpdateCheck: (on: boolean) => void;
}): ReactElement | null {
  const ref = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  /** The site form holds edits that closing it would lose. */
  const [formDirty, setFormDirty] = useState(false);
  /** What to do once the user agrees to discard those edits (closing the form or the dialog). */
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const config = domino.config;
  /** Runs `then` now, or after a confirm when it would throw away an edited site form. */
  const guard = (then: () => void): void => {
    if (formDirty) setPendingDiscard(() => then);
    else then();
  };
  const closeDialog = (): void => {
    guard(onClose);
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!config) return null;

  const editingSite = editing?.kind === "edit" ? config.sites.find((s) => s.id === editing.id) : undefined;

  const save = (sites: SiteConfig[], defaultSiteIds: readonly string[]): Promise<unknown> =>
    domino.saveConfig({ ...config, sites, defaultSiteIds: defaultSiteIds.filter((id) => sites.some((s) => s.id === id)) });

  /** Shows a failed save in the error banner, then rethrows so callers can stay open on failure. */
  const persist = async (sites: SiteConfig[], defaultSiteIds = config.defaultSiteIds): Promise<void> => {
    setError(null);
    try {
      await save(sites, defaultSiteIds);
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    }
  };

  const submit = async ({ site, isDefault, token, test }: SiteFormResult): Promise<void> => {
    const exists = config.sites.some((s) => s.id === site.id);
    const sites = exists ? config.sites.map((s) => (s.id === site.id ? { ...site, cloudId: s.cloudId } : s)) : [...config.sites, site];
    const defaults = isDefault ? [...new Set([...config.defaultSiteIds, site.id])] : config.defaultSiteIds.filter((id) => id !== site.id);
    // The token first: if the keychain refuses it, nothing is saved and the form can simply be
    // submitted again. Failures show in the form, so not in the dialog's banner as well.
    if (token && site.auth.type === "apiToken") await domino.store.setSecret(site.auth.secretRef, token);
    setError(null);
    await save(sites, defaults);
    setEditing(null);
    setJustSaved(site.id);
    if (test) void domino.testConnection(site.id); // health failures land in domino.health, never a rejection
  };

  const switchToLive = (): void => {
    domino.saveConfig({ ...config, backend: "jira" }).catch((e: unknown) => {
      setError(errorMessage(e));
    });
  };

  const form = editing && (
    <SiteForm
      key={editing.kind === "edit" ? editing.id : "new"}
      initial={editingSite ?? blankSite(config.sites)}
      initialDefault={editingSite ? config.defaultSiteIds.includes(editingSite.id) : true}
      others={config.sites.filter((s) => s.id !== editingSite?.id)}
      isNew={editing.kind === "new"}
      store={domino.store}
      backend={config.backend}
      onSwitchToLive={switchToLive}
      onSubmit={submit}
      onCancel={() => {
        setEditing(null);
      }}
      onDismiss={() => {
        guard(() => {
          setEditing(null);
        });
      }}
      onDirty={setFormDirty}
    />
  );

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="settings-title"
      // Esc on the dialog: ask first if it would lose an edited site.
      onCancel={(e) => {
        if (!formDirty) return;
        e.preventDefault();
        closeDialog();
      }}
      onClose={() => {
        setEditing(null);
        setError(null); // an old failure shouldn't greet the next visit
        setPendingDiscard(null);
        onClose();
      }}
    >
      <header>
        <h2 id="settings-title">Settings</h2>
        <button type="button" className="icon-btn" onClick={closeDialog} aria-label="Close settings">
          <Icon name="close" />
        </button>
      </header>
      {pendingDiscard && (
        <div className="banner warn actionable" role="alertdialog" aria-label="Unsaved site changes">
          <div className="banner-text">Discard your changes to this site?</div>
          <div className="banner-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                const then = pendingDiscard;
                setPendingDiscard(null);
                setEditing(null);
                then();
              }}
            >
              Discard
            </button>
            <button
              type="button"
              // The safe choice gets focus, so Enter keeps the edits.
              autoFocus
              onClick={() => {
                setPendingDiscard(null);
              }}
            >
              Keep editing
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {domino.configFile?.problem && (
        <p className="banner error">
          The settings file couldn't be read, so Domino started with no sites. Saving here replaces <code>{domino.configFile.path}</code>.
        </p>
      )}
      <BackendSection domino={domino} config={config} />
      <AutoRefreshField
        minutes={refreshMinutes}
        onMinutes={onRefreshMinutes}
        notifyUnblocked={notifyUnblocked}
        onNotifyUnblocked={onNotifyUnblocked}
      />
      <CachedTicketsSection onClear={domino.clearCache} />
      <AppUpdatesSection updates={updates} autoCheck={autoUpdateCheck} onAutoCheck={onAutoUpdateCheck} />
      <div className="section-row">
        <h3 className="section-h">Sites</h3>
        {editing?.kind !== "new" && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              guard(() => {
                setEditing({ kind: "new" });
              });
            }}
          >
            + Add site
          </button>
        )}
      </div>
      {editing?.kind === "new" && form}
      <table className="sites-table">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Base URL</th>
            <th scope="col">Auth</th>
            <th scope="col">Enabled</th>
            <th scope="col">Connection</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {config.sites.map((s) => (
            <SiteRow
              key={s.id}
              site={s}
              highlight={justSaved === s.id}
              health={domino.health[s.id] ?? { state: "unknown" }}
              onToggle={(enabled) => {
                persist(config.sites.map((x) => (x.id === s.id ? { ...x, enabled } : x))).catch(() => {});
              }}
              onTest={() => {
                void domino.testConnection(s.id);
              }}
              onEdit={() => {
                guard(() => {
                  setEditing({ kind: "edit", id: s.id });
                });
              }}
              onRemove={() => {
                persist(config.sites.filter((x) => x.id !== s.id)).catch(() => {});
              }}
            />
          ))}
          {config.sites.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No sites yet. Click <strong>+ Add site</strong> and paste a link from your Jira.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editing?.kind === "edit" && form}
    </dialog>
  );
}

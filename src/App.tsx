import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";
import { configStore, jiraSource } from "./platform";
import { useDomino } from "./state/useDomino";
import { Canvas, useFocusNode, type Filters, type ViewOptions } from "./ui/Canvas";
import { ErrorBanner } from "./ui/ErrorBanner";
import { FilterPanel } from "./ui/FilterPanel";
import { ScopeInputs } from "./ui/ScopeInputs";
import { SettingsDialog } from "./ui/Settings/SettingsDialog";
import { SiteSelector } from "./ui/SiteSelector";
import { WarningsPanel } from "./ui/WarningsPanel";

const DEFAULT_FILTERS: Filters = { blocks: true, relates: false, duplicates: false, crossSite: true };
const DEFAULT_VIEW: ViewOptions = { groupBy: "none", criticalPath: false, ready: false };

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell() {
  const domino = useDomino(configStore, jiraSource);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focusNode = useFocusNode();
  const { config, load, graph } = domino;

  const errors = load.status === "done" ? load.result.errors : [];
  const full = graph.nodes.filter((n) => !n.ghost).length;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <span aria-hidden="true">▣▣</span> Domino
        </h1>
        {config && (
          <>
            <SiteSelector sites={config.sites} selected={domino.selected} onChange={domino.setSelected} />
            <ScopeInputs sites={domino.selectedSites} scope={domino.scope} onApply={domino.setScope} />
          </>
        )}
        <span className="status-text" aria-live="polite">
          {load.status === "loading"
            ? "Loading…"
            : load.status === "done" && load.result.kind === "ok"
              ? `${full} issues · ${graph.nodes.length - full} outside scope`
              : ""}
        </span>
        <button type="button" className="icon-btn" onClick={domino.reload} aria-label="Reload" title="Reload">
          ↻
        </button>
        <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
          ⚙
        </button>
      </header>

      {domino.configError && (
        <div className="banner error" role="alert">
          Could not load configuration: {domino.configError}
        </div>
      )}
      {config && <ErrorBanner errors={errors} sites={config.sites} attempted={domino.selectedSites.length} />}

      <main className="workspace">
        <aside className="sidebar" aria-label="Filters and warnings">
          <FilterPanel filters={filters} onFilters={setFilters} view={view} onView={setView} />
          <WarningsPanel graph={graph} onFocusNode={focusNode} />
          <Legend />
        </aside>
        <section className="canvas" aria-label="Dependency graph">
          <Canvas graph={graph} filters={filters} view={view} showSiteBadges={domino.loadedSiteCount > 1} />
          <CanvasMessage domino={domino} />
        </section>
      </main>

      <SettingsDialog domino={domino} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function CanvasMessage({ domino }: { domino: ReturnType<typeof useDomino> }) {
  const { load, selectedSites, graph } = domino;
  let msg: React.ReactNode = null;
  if (selectedSites.length === 0 && domino.config) msg = "Select at least one site, or add one in Settings (⚙).";
  else if (load.status === "failed") msg = `Loading failed: ${load.message}`;
  else if (load.status === "done" && load.result.kind === "overCap")
    msg = (
      <>
        <strong>Too many issues ({load.result.count}+).</strong> Domino shows at most 300. Narrow the scope with a tighter JQL, an epic, or a smaller depth.
      </>
    );
  else if (load.status === "done" && load.result.kind === "ok" && graph.nodes.length === 0 && load.result.errors.length === 0)
    msg = "No issues match this scope.";
  if (!msg) return null;
  return (
    <div className="canvas-message" role="status">
      {msg}
    </div>
  );
}

function Legend() {
  return (
    <section className="panel" aria-labelledby="legend-h">
      <h2 id="legend-h">Legend</h2>
      <ul className="legend-list">
        <li><span className="swatch status-todo" aria-hidden="true" /> To Do</li>
        <li><span className="swatch status-inprogress" aria-hidden="true" /> In Progress</li>
        <li><span className="swatch status-done" aria-hidden="true" /> Done</li>
        <li><span className="legend legend-cycle" aria-hidden="true" /> Blocking cycle</li>
        <li><span className="legend legend-critical" aria-hidden="true" /> Critical path</li>
        <li><span className="swatch ghost-swatch" aria-hidden="true" /> Outside scope</li>
      </ul>
      <p className="hint">Hover or focus a card to trace its blockers. Enter or click opens it in Jira.</p>
    </section>
  );
}

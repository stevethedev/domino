import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import type { GraphNode } from "../graph/types";

const MAX_RESULTS = 8;

/** Key-prefix matches first, then key or summary substring matches; ghosts last. */
export function findIssues(nodes: readonly GraphNode[], query: string): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (n: GraphNode): number => {
    const key = n.key.toLowerCase();
    if (key === q) return 0;
    if (key.startsWith(q)) return 1;
    if (key.includes(q)) return 2;
    if (n.summary.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return nodes
    .map((n) => ({ n, r: rank(n) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || Number(a.n.ghost) - Number(b.n.ghost) || a.n.uid.localeCompare(b.n.uid))
    .slice(0, MAX_RESULTS)
    .map(({ n }) => n);
}

/** Jump to an issue by key or summary. `/` or ⌘K/Ctrl+K focuses it from anywhere. */
export function QuickFind({
  nodes,
  showSite,
  onPick,
}: {
  nodes: readonly GraphNode[];
  showSite: boolean;
  onPick: (uid: string) => void;
}): ReactElement {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const results = useMemo(() => findIssues(nodes, query), [nodes, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const pick = (n: GraphNode): void => {
    setQuery("");
    setOpen(false);
    onPick(n.uid);
  };

  const expanded = open && query.trim() !== "";
  return (
    <div className="quick-find">
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Find a ticket"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && results[active] ? `${id}-${active}` : undefined}
        placeholder="Find ticket…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
          }, 120)
        }
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setQuery("");
            input.current?.blur();
          }
        }}
        spellCheck={false}
        autoComplete="off"
      />
      <kbd className="quick-find-kbd" aria-hidden="true">
        /
      </kbd>
      {expanded && (
        <ul id={`${id}-list`} role="listbox" className="quick-find-list" aria-label="Matching tickets">
          {results.length === 0 && <li className="muted quick-find-empty">No tickets match "{query.trim()}"</li>}
          {results.map((n, i) => (
            <li
              key={n.uid}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
              }} // keep focus in the input until the pick
              onClick={() => {
                pick(n);
              }}
              onMouseEnter={() => {
                setActive(i);
              }}
            >
              <span className="card-key">{n.key}</span>
              <span className="quick-find-summary">{n.summary}</span>
              {(showSite || n.ghost) && (
                <span className="site-badge" style={{ "--site": n.siteColor ?? "#6b7280" }}>
                  {n.siteLabel}
                </span>
              )}
              <span className={`pill pill-${n.statusCategory}`}>{n.statusName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

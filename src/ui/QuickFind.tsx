import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import type { GraphNode } from "../graph/types";
import { useFocusReturn } from "./useFocusReturn";
import { viewTabStop } from "./viewItems";

const MAX_RESULTS = 8;

/** Every match: key-prefix matches first, then key or summary substring matches; ghosts last. */
export function matchIssues(nodes: readonly GraphNode[], query: string): GraphNode[] {
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
    .map(({ n }) => n);
}

/** The matches Find lists (see `matchIssues`), best first. */
export const findIssues = (nodes: readonly GraphNode[], query: string): GraphNode[] => matchIssues(nodes, query).slice(0, MAX_RESULTS);

/** What Find announces as you type: how many tickets match, and how many of them are listed. */
export function findStatus(query: string, total: number, shown: number): string {
  const q = query.trim();
  if (!q) return "";
  if (total === 0) return `No tickets match "${q}"`;
  const matches = total === 1 ? "1 ticket matches" : `${total} tickets match`;
  return shown < total ? `${matches}, showing the first ${shown}` : matches;
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
  const matches = useMemo(() => matchIssues(nodes, query), [nodes, query]);
  const results = matches.slice(0, MAX_RESULTS);
  // Where focus was before Find: the second Esc goes back there.
  const { remember, restore } = useFocusReturn();

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

  const searching = open && query.trim() !== "";
  // The listbox exists only with options in it; "No tickets match" is said beside it.
  const listed = searching && results.length > 0;
  const listId = `${id}-list`;
  return (
    <div className="quick-find">
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Find a ticket"
        aria-expanded={listed}
        aria-controls={listed ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listed && results[active] ? `${id}-${active}` : undefined}
        placeholder="Find ticket…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          remember(e.relatedTarget);
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
          } else if (e.key === "Enter" && listed && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            // A search field clears itself on Esc: the first Esc only closes the list.
            e.preventDefault();
            if (searching) {
              setOpen(false);
              return;
            }
            setQuery("");
            restore((opener) => [opener, viewTabStop()]);
          }
        }}
        spellCheck={false}
        autoComplete="off"
      />
      <kbd className="quick-find-kbd" aria-hidden="true">
        /
      </kbd>
      {/* Always mounted, so each count is announced as it changes. */}
      <span className="sr-only" role="status">
        {searching ? findStatus(query, matches.length, results.length) : ""}
      </span>
      {searching && results.length === 0 && (
        // Announced by the status above.
        <p className="quick-find-list quick-find-empty muted" aria-hidden="true">
          No tickets match "{query.trim()}"
        </p>
      )}
      {listed && (
        <ul id={listId} role="listbox" className="quick-find-list" aria-label="Matching tickets">
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

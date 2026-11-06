import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { announce, cancelAnnouncement, spokenText } from "./Announcer";

/** How much a banner needs attention: errors first, then warnings, then news. */
export type Severity = "error" | "warning" | "info";

type Entry = Readonly<{ id: string; severity: Severity; seq: number }>;

const RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

/** Most severe first; between equals, the newest. */
export const rankBanners = <T extends Entry>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.seq - a.seq);

/** Where each shown banner goes, by id: only the top one when folded, all of them when expanded. */
export const placesOf = (ranked: readonly Entry[], expanded: boolean): ReadonlyMap<string, number> =>
  new Map((expanded ? ranked : ranked.slice(0, 1)).map((b, i) => [b.id, i]));

/** The toggle under the top banner. */
export const moreText = (hidden: number, expanded: boolean): string => (expanded ? "Show fewer" : `+${hidden} more`);

type Area = Readonly<{
  /** Adds a banner; returns how to take it away, saying whether focus was in it. */
  register: (id: string, severity: Severity, element: HTMLElement) => (hadFocus: boolean) => void;
  /** Its place among the shown banners, or null while it's folded away. */
  placeOf: (id: string) => number | null;
  /** True the first time it's asked for `id` while `id` is the top banner: say it then. */
  firstTimeOnTop: (id: string) => boolean;
}>;

/** Outside an area (a test, a dialog), a banner is simply shown, and said when it appears. */
const standalone: Area = {
  register: () => () => undefined,
  placeOf: () => 0,
  firstTimeOnTop: () => true,
};
const AreaContext = createContext<Area>(standalone);

/**
 * The page's banners, one at a time: the most severe (ties: the newest), with "+N more" to show the
 * rest in place. Each banner still decides when it's there (and when it's dismissed); dismissing one
 * shows the next, and focus goes on to it.
 */
export function BannerArea({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [entries, setEntries] = useState<readonly (Entry & { element: HTMLElement })[]>([]);
  const [expanded, setExpanded] = useState(false);
  const seq = useRef(0);
  const said = useRef(new Set<string>());
  const focusNext = useRef(false);

  const ranked = useMemo(() => rankBanners(entries), [entries]);
  const places = useMemo(() => placesOf(ranked, expanded), [ranked, expanded]);
  const top = ranked.at(0);

  const register = useCallback<Area["register"]>((id, severity, element) => {
    seq.current += 1;
    const entry = { id, severity, seq: seq.current, element };
    setEntries((all) => [...all.filter((e) => e.id !== id), entry]);
    return (hadFocus): void => {
      said.current.delete(id); // back again later, it's news again
      if (hadFocus) focusNext.current = true;
      setEntries((all) => all.filter((e) => e !== entry));
    };
  }, []);

  const area = useMemo<Area>(
    () => ({
      register,
      placeOf: (id): number | null => places.get(id) ?? null,
      firstTimeOnTop: (id): boolean => {
        if (id !== top?.id || said.current.has(id)) return false;
        said.current.add(id);
        return true;
      },
    }),
    [register, places, top?.id],
  );

  // Seen expanded, a banner isn't news when it later reaches the top.
  useEffect(() => {
    for (const id of places.keys()) if (id !== top?.id) said.current.add(id);
  }, [places, top?.id]);

  // Fewer than two: nothing left to fold.
  if (expanded && ranked.length < 2) setExpanded(false);

  // The banner with focus went away: on to the one now on top.
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    // Its first action, rather than a "What's new" toggle before it.
    const el = top?.element;
    (el?.querySelector<HTMLElement>("button") ?? el?.querySelector<HTMLElement>("a[href], summary"))?.focus();
  }, [top]);

  return (
    <AreaContext.Provider value={area}>
      <div className="banner-area">
        {children}
        {ranked.length > 1 && (
          <button
            type="button"
            className="link-btn banner-more"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {moreText(ranked.length - 1, expanded)}
          </button>
        )}
      </div>
    </AreaContext.Provider>
  );
}

/**
 * One banner in a `BannerArea`. Rendered while it's there, shown only when the area says so (so a
 * folded one keeps its state), and said once, the first time it's on top: assertively for an error.
 * What's said is its `data-said` part if it has one (the message, not its buttons), else all of it.
 * `id` names what it says: a banner whose message changes is news again.
 */
export function Banner({
  id,
  severity,
  className,
  children,
}: Readonly<{ id: string; severity: Severity; className: string; children: ReactNode }>): ReactElement {
  const area = useContext(AreaContext);
  const { register } = area; // stable, unlike the area: registering again would make this the newest
  const ref = useRef<HTMLDivElement>(null);
  const hasFocus = useRef(false);
  const place = area.placeOf(id);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const unregister = register(id, severity, ref.current);
    return (): void => {
      cancelAnnouncement(`banner:${id}`);
      unregister(hasFocus.current);
    };
  }, [register, id, severity]);

  const saidFor = useRef<string | null>(null);
  useEffect(() => {
    if (place !== 0 || !ref.current || saidFor.current === id || !area.firstTimeOnTop(id)) return;
    saidFor.current = id;
    const part = ref.current.querySelector("[data-said]") ?? ref.current;
    announce(spokenText(part).trim(), { assertive: severity === "error", source: `banner:${id}` });
  });

  return (
    <div
      ref={ref}
      className={className}
      hidden={place === null}
      // The toggle sits right under the top banner (order 1); the rest follow it.
      style={place ? { order: place + 1 } : undefined}
      onFocus={() => {
        hasFocus.current = true;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hasFocus.current = false;
      }}
    >
      {children}
    </div>
  );
}

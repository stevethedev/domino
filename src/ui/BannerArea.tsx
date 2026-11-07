import {
  Children,
  createContext,
  isValidElement,
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

/** Where focus goes once the banner it was in, shown at `place`, is gone: the one now there, or the one above. */
export const focusTargetAfter = (shown: readonly string[], place: number): string | undefined => shown[place] ?? shown.at(-1);

/** Folded, a newer or more severe banner would hide the one with focus: show them all instead. */
export const expandsToKeepFocus = ({
  focused,
  top,
  registered,
  expanded,
}: Readonly<{ focused: string | null; top: string | undefined; registered: ReadonlySet<string>; expanded: boolean }>): boolean =>
  !expanded && focused !== null && focused !== top && registered.has(focused);

/**
 * What a blur from a banner means. Into itself, it stays. To somewhere else (the toggle, say), it's
 * left. To nowhere, it can't tell yet: that's also what moving the banner in the DOM looks like.
 */
export const blurLeaves = (intoItself: boolean, toSomewhere: boolean): "stays" | "leaves" | "unsure" =>
  intoItself ? "stays" : toSomewhere ? "leaves" : "unsure";

/** The toggle's place among the children. Children's keys (from `Children.toArray`) start with ".". */
export const MORE = "more";

/**
 * The area's children in the order they're read and tabbed through: the top banner, the toggle, the
 * other banners by rank, then children with no banner up (they render nothing). `slots` maps each
 * banner's id to its child's key.
 */
export function childOrder(keys: readonly string[], slots: ReadonlyMap<string, string>, ranked: readonly string[]): string[] {
  const banners = ranked.flatMap((id) => slots.get(id) ?? []);
  const rest = keys.filter((k) => !banners.includes(k));
  return banners.length > 1 ? [banners[0], MORE, ...banners.slice(1), ...rest] : [...banners, ...rest];
}

/**
 * How long after it's asked for an announcement may still be waiting to be read (the Announcer
 * reads after about 50 ms). A banner folded away sooner wasn't heard, so it's said when it's back on top.
 */
const UNHEARD_MS = 100;

type Area = Readonly<{
  /** Adds a banner from the child at `slot`; returns how to take it away. */
  register: (id: string, severity: Severity, slot: string, element: HTMLElement) => () => void;
  /** Its place among the shown banners, or null while it's folded away. */
  placeOf: (id: string) => number | null;
  /** True the first time it's asked for `id` while `id` is the top banner: say it then. */
  firstTimeOnTop: (id: string) => boolean;
  /** Folded away before it was heard: it's news again. */
  unsay: (id: string) => void;
  /** Focus went into the banner, onto `element`. */
  focusIn: (id: string, element: HTMLElement) => void;
  /** Focus left the banner (if it's still the one with focus). */
  focusOut: (id: string) => void;
}>;

/** Outside an area (a test, a dialog), a banner is simply shown, and said when it appears. */
const standalone: Area = {
  register: () => () => undefined,
  placeOf: () => 0,
  firstTimeOnTop: () => true,
  unsay: () => undefined,
  focusIn: () => undefined,
  focusOut: () => undefined,
};
const AreaContext = createContext<Area>(standalone);
/** Which of the area's children a banner comes from. */
const SlotContext = createContext("");

type Registered = Entry & Readonly<{ slot: string; element: HTMLElement }>;

/** Focus is nowhere: what the browser does when the focused element goes away. */
const focusLost = (): boolean => document.activeElement === null || document.activeElement === document.body;

/** A banner's first action, rather than a "What's new" toggle before it. */
const firstAction = (el: HTMLElement): HTMLElement | null =>
  el.querySelector<HTMLElement>("button") ?? el.querySelector<HTMLElement>("a[href], summary");

/**
 * The page's banners, one at a time: the most severe (ties: the newest), with "+N more" to show the
 * rest in place. Each banner still decides when it's there (and when it's dismissed); dismissing one
 * shows the next, and focus goes on to it. The children are rendered in the order they're shown, so
 * Tab and screen readers follow the screen; each keeps its key, so moving it keeps its state.
 */
export function BannerArea({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [entries, setEntries] = useState<readonly Registered[]>([]);
  const [expanded, setExpanded] = useState(false);
  const seq = useRef(0);
  const said = useRef(new Set<string>());
  const focused = useRef<string | null>(null);
  /** What had focus in that banner. */
  const focusedEl = useRef<HTMLElement | null>(null);
  /** The place of a banner that went away with focus in it, until focus has moved on. */
  const refocusAt = useRef<number | null>(null);

  const ranked = useMemo(() => rankBanners(entries), [entries]);
  const places = useMemo(() => placesOf(ranked, expanded), [ranked, expanded]);
  const placesNow = useRef(places);
  placesNow.current = places;
  const top = ranked.at(0);

  const register = useCallback<Area["register"]>((id, severity, slot, element) => {
    seq.current += 1;
    const entry = { id, severity, seq: seq.current, slot, element };
    setEntries((all) => [...all.filter((e) => e.id !== id), entry]);
    return (): void => {
      said.current.delete(id); // back again later, it's news again
      if (focused.current === id) {
        focused.current = null;
        focusedEl.current = null;
        refocusAt.current = placesNow.current.get(id) ?? 0;
      }
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
      unsay: (id): void => {
        said.current.delete(id);
      },
      focusIn: (id, element): void => {
        focused.current = id;
        focusedEl.current = element;
      },
      focusOut: (id): void => {
        if (focused.current !== id) return;
        focused.current = null;
        focusedEl.current = null;
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
  // Folded, a new top banner would hide the one being used: show them all, before it's ever drawn hidden
  // (hiding it would drop focus).
  const registered = new Set(entries.map((e) => e.id));
  if (expandsToKeepFocus({ focused: focused.current, top: top?.id, registered, expanded })) setExpanded(true);

  const byKey = new Map(
    Children.toArray(children)
      .filter(isValidElement)
      .map((child) => [String(child.key), child]),
  );
  const slots = new Map(entries.map((e) => [e.id, e.slot]));
  const order = childOrder(
    [...byKey.keys()],
    slots,
    ranked.map((e) => e.id),
  );

  // Some browsers drop focus from a banner moved into its place: put it back, before it's drawn. Only
  // when the order changed, so a click elsewhere isn't undone.
  const orderKey = order.join(" ");
  useLayoutEffect(() => {
    const el = focusedEl.current;
    if (focusLost() && el?.isConnected && !el.closest("[hidden]")) el.focus({ preventScroll: true });
  }, [orderKey]);

  // The banner with focus went away: on to the one now in its place. Only if focus really went with
  // it: a banner that's still there under a new id (an install that failed) keeps it.
  useEffect(() => {
    if (refocusAt.current === null) return;
    const shown = [...places.keys()];
    const target = ranked.find((e) => e.id === focusTargetAfter(shown, refocusAt.current ?? 0));
    refocusAt.current = null;
    if (target && focusLost()) firstAction(target.element)?.focus();
  }, [ranked, places]);

  return (
    <AreaContext.Provider value={area}>
      <div className="banner-area">
        {order.map((key) =>
          key === MORE ? (
            <button
              key={MORE}
              type="button"
              className="link-btn banner-more"
              aria-expanded={expanded}
              onClick={(e) => {
                // WebKit doesn't focus a clicked button: focus left in a banner would keep it shown.
                e.currentTarget.focus();
                setExpanded(!expanded);
              }}
            >
              {moreText(ranked.length - 1, expanded)}
            </button>
          ) : (
            <SlotContext.Provider key={key} value={key}>
              {byKey.get(key)}
            </SlotContext.Provider>
          ),
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
  const slot = useContext(SlotContext);
  const { register } = area; // stable, unlike the area: registering again would make this the newest
  const ref = useRef<HTMLDivElement>(null);
  const place = area.placeOf(id);
  const source = `banner:${id}`;
  const saidFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const unregister = register(id, severity, slot, ref.current);
    return (): void => {
      cancelAnnouncement(source);
      saidFor.current = null; // like the area's record: back under this id later, it's news again
      unregister();
    };
  }, [register, id, severity, slot, source]);
  const saidAt = useRef(0);
  useEffect(() => {
    if (place !== 0 || !ref.current || saidFor.current === id || !area.firstTimeOnTop(id)) return;
    saidFor.current = id;
    saidAt.current = performance.now();
    const part = ref.current.querySelector("[data-said]") ?? ref.current;
    announce(spokenText(part).trim(), { assertive: severity === "error", source });
  });

  // Folded away: what it was about to say isn't read now. If it likely wasn't heard, it's said later.
  useEffect(() => {
    if (place !== null || saidFor.current !== id) return;
    cancelAnnouncement(source);
    if (performance.now() - saidAt.current < UNHEARD_MS) {
      saidFor.current = null;
      area.unsay(id);
    }
  }, [place, id, source, area]);

  return (
    <div
      ref={ref}
      className={className}
      hidden={place === null}
      onFocus={(e) => {
        area.focusIn(id, e.target);
      }}
      onBlur={(e) => {
        const el = e.currentTarget;
        const leaves = blurLeaves(el.contains(e.relatedTarget), e.relatedTarget !== null);
        // At once, so a click on "Show fewer" that follows isn't undone by a stale record.
        if (leaves === "leaves") area.focusOut(id);
        // A move blurs it for a moment: gone only if focus is still elsewhere a frame later.
        else if (leaves === "unsure")
          requestAnimationFrame(() => {
            if (!el.contains(document.activeElement)) area.focusOut(id);
          });
      }}
    >
      {children}
    </div>
  );
}

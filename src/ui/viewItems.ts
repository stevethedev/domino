/** The card (graph) or row (timeline) drawn for an issue, if it's drawn. */
export const viewItemOf = (uid: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.canvas [data-uid="${CSS.escape(uid)}"], .canvas [data-tl-uid="${CSS.escape(uid)}"]`);

/**
 * The open view's one Tab stop (see `tabStopOf`): a card, a row, or a lane header (when every
 * timeline row is filtered out or folded).
 */
export const viewTabStop = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.canvas :is([data-uid], [data-tl-uid], [data-tl-lane])[tabindex="0"]');

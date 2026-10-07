/**
 * How far right of a card's centre to aim `setCenter` (in flow units) so the card lands in the
 * middle of the part of the pane the details drawer leaves visible: half the covered width,
 * divided by the zoom. Zero when nothing covers the pane (`visibleRight` is its right edge), or
 * when what's left (from `paneLeft`) is narrower than `minVisible` (a card), as in a narrow pane
 * the drawer covers entirely: then the pane's own centre is as good as anywhere.
 */
export function visibleCentreShift(paneRight: number, visibleRight: number, zoom: number, paneLeft = 0, minVisible = 0): number {
  if (visibleRight - paneLeft < minVisible) return 0;
  return Math.max(0, paneRight - visibleRight) / 2 / zoom;
}

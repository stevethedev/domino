/**
 * How far right of a card's centre to aim `setCenter` (in flow units) so the card lands in the
 * middle of the part of the pane the details drawer leaves visible: half the covered width,
 * divided by the zoom. Zero when nothing covers the pane (`visibleRight` is its right edge).
 */
export function visibleCentreShift(paneRight: number, visibleRight: number, zoom: number): number {
  return Math.max(0, paneRight - visibleRight) / 2 / zoom;
}

/**
 * The text of rendered markup, for comparing what a reader sees. Strips tags until none are left,
 * so a tag split by another (`<scr<b>ipt>`) can't survive one pass.
 */
export function markupText(html: string): string {
  let text = html;
  for (let prev = ""; prev !== text;) {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text;
}

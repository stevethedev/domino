/** Inputs where a letter key does nothing: shortcut keys pressed there still work. */
const NOT_TYPED_IN = new Set(["radio", "checkbox", "button", "submit", "reset", "range", "color", "file", "image"]);

/**
 * Whether a key pressed in `el` types (a text field, select or editable region), so a one-letter
 * shortcut mustn't act on it. Radios, checkboxes and buttons don't type.
 */
export function typesText(el: Readonly<{ tagName: string; type?: string; isContentEditable?: boolean }>): boolean {
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !NOT_TYPED_IN.has(el.type ?? "");
}

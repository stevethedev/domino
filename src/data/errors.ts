/** Normalizes errors from Tauri (strings or serialized objects) and JS into a message. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "Unknown error";
}

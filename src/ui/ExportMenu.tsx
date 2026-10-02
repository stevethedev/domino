import { useState, type ReactElement } from "react";
import { copyImage, saveFile } from "../platform";
import { Icon } from "./Icon";
import { localToday } from "./timeline/timelineLayout";

export type Capture = { png: () => Promise<Blob>; svg: () => Promise<string> };

/** "Export" menu for a view: copy it as an image, or save it as PNG or SVG (`name` seeds the file name). */
export function ExportMenu({ name, capture }: { name: string; capture: Capture }): ReactElement {
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = (ext: string): string => `domino-${name}-${localToday()}.${ext}`;
  const run = async (action: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const done = await action();
      if (done) setStatus({ kind: "ok", text: done });
    } catch (e) {
      setStatus({ kind: "error", text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="export-menu">
      <summary aria-label={`Export the ${name}`}>
        Export <Icon name="chevron-down" className="disclosure-caret" />
      </summary>
      <div className="popover export-popover">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              await copyImage(await capture.png());
              return "Copied: paste it into chat or a document.";
            });
          }}
        >
          Copy image
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(async () =>
              (await saveFile(file("png"), await capture.png(), { name: "PNG image", extensions: ["png"] })) ? "Saved." : null,
            );
          }}
        >
          Save as PNG…
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(async () =>
              (await saveFile(file("svg"), await capture.svg(), { name: "SVG image", extensions: ["svg"] })) ? "Saved." : null,
            );
          }}
        >
          Save as SVG…
        </button>
        <p className={status?.kind === "error" ? "field-error" : "hint"} role="status">
          {busy ? "Rendering…" : (status?.text ?? "The whole view, not just what's on screen.")}
        </p>
      </div>
    </details>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import { defined } from "./lib/guards";

async function start(): Promise<void> {
  // `npm run dev:web` only: answer Tauri IPC in the browser from fixtures. Stripped from real builds.
  if (import.meta.env.MODE === "web") await (await import("./dev/mockIpc")).installMockIpc();
  const { App } = await import("./App");
  ReactDOM.createRoot(defined(document.getElementById("root"), "#root element")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Nothing is mounted yet to show an error in, so a failed start (e.g. a chunk that will not load) goes to the console.
start().catch((e: unknown) => { console.error("Domino failed to start", e); });

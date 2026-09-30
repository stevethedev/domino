import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";

async function start() {
  // `npm run dev:web` only: answer Tauri IPC in the browser from fixtures. Stripped from real builds.
  if (import.meta.env.MODE === "web") await (await import("./dev/mockIpc")).installMockIpc();
  const { App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();

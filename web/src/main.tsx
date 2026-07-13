import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@carbon/styles/css/styles.css";
import "@carbon/charts-react/styles.css";
import "./app.css"; // last, so its header overrides win over Carbon's defaults
import App from "./App";
import { setApiBase } from "./api";

const PREFIX = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Resolve the API origin BEFORE the first render. The pages start polling as soon as they mount, so
 * if the base were applied after mounting, the first round of requests would race it and go to the
 * wrong origin — visible as a flash of "failed to fetch" on load in the split deployment.
 *
 * config.json itself is always same-origin (it is what tells us where the API is), and a failure to
 * read it is not fatal: the default base is same-origin, which is exactly the local deployment.
 */
async function boot(): Promise<void> {
  try {
    const r = await fetch(`${PREFIX}/config.json`);
    if (r.ok) {
      const cfg = (await r.json()) as { apiBase?: string };
      setApiBase(cfg.apiBase);
    }
  } catch {
    /* same-origin default stands */
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter basename={PREFIX}>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

void boot();

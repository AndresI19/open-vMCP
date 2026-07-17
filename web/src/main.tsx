import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@carbon/styles/css/styles.css';
import '@carbon/charts-react/styles.css';
import './app.css'; // last, so its header overrides win over Carbon's defaults
import App from './App';
import { setApiBase, setHomeUrl, setMcpUrl } from './api';

const PREFIX = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Resolve the API origin BEFORE first render. Pages poll on mount, so applying the base afterwards
 * would race the first requests to the wrong origin — a flash of "failed to fetch" in the split
 * deploy. config.json is always same-origin, and failing to read it is not fatal: the default base is
 * same-origin, the local deploy.
 */
async function boot(): Promise<void> {
  try {
    const r = await fetch(`${PREFIX}/config.json`);
    if (r.ok) {
      const cfg = (await r.json()) as { apiBase?: string; mcpUrl?: string; homeUrl?: string };
      setApiBase(cfg.apiBase);
      setMcpUrl(cfg.mcpUrl);
      setHomeUrl(cfg.homeUrl);
    }
  } catch {
    /* same-origin default stands */
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter basename={PREFIX}>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

void boot();

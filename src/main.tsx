import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";

import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/theme.css";

// HashRouter (not BrowserRouter): the packaged app is served from Tauri's
// custom asset protocol, not a real HTTP server, so there's no server-side
// fallback to handle deep-linked paths on refresh. Hash routing sidesteps
// that entirely and needs no server cooperation.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

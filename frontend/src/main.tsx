import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Distinguish the staging build's browser tab from production (both otherwise
// read "HPM Intranet"). Driven by the Vite --mode the build was produced with.
if (import.meta.env.MODE === "staging") {
  document.title = "HPM Intranet (STAGING)";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

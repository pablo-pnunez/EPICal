import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";
import "./own.css";
import { applyTheme, getTheme } from "./lib/theme";

applyTheme(getTheme()); // antes de pintar, para evitar un parpadeo del tema equivocado

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

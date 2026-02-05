import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { useAuthStore } from "./stores/authStore";

// Hydrate auth state from localStorage before rendering
useAuthStore.getState().hydrate();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

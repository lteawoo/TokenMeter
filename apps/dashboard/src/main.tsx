import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";

if (!document.documentElement.dataset.theme) {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
}

createRoot(document.getElementById("root")!).render(<App />);

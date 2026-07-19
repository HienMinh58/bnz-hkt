import React from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "./components/AuthGate";
import App from "./pages/App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);

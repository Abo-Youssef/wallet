import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import "@fontsource/ibm-plex-sans-arabic/latin-400.css";
import "@fontsource/ibm-plex-sans-arabic/latin-600.css";
import App from "./App.jsx";
import { WalletProvider } from "./state/WalletProvider.jsx";
import "./styles.css";
async function start() {
  if (__PREVIEW__) await import("../preview/demo.mjs");
  createRoot(document.getElementById("app")).render(
    <WalletProvider>
      <App />
    </WalletProvider>,
  );
}
start();

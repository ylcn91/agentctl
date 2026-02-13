import React, { useState } from "react";
import { Box } from "ink";
import { Header } from "./components/Header.js";
import { Dashboard } from "./components/Dashboard.js";

export function App() {
  const [view, setView] = useState("dashboard");

  return (
    <Box flexDirection="column">
      <Header view={view} />
      {view === "dashboard" && <Dashboard onNavigate={setView} />}
      {/* Other views added in subsequent tasks */}
    </Box>
  );
}

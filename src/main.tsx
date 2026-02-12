import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { startSyncService } from "@/lib/sync-service";

// Start background sync service for offline uploads
startSyncService();

createRoot(document.getElementById("root")!).render(<App />);

import { Navigate } from "react-router-dom";
import { useAppMode } from "@/contexts/AppModeContext";

/** Redirects "/" to "/china" when the user is in Asia Trip mode */
export default function ModeRedirect({ children }: { children: React.ReactNode }) {
  const { mode } = useAppMode();
  if (mode === "china_trip") return <Navigate to="/china" replace />;
  return <>{children}</>;
}

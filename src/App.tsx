import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
import AppShell from "@/components/layout/AppShell";

const Auth = lazy(() => import("@/pages/Auth"));
const Trips = lazy(() => import("@/pages/Trips"));
const NewTrip = lazy(() => import("@/pages/NewTrip"));
const TripDetail = lazy(() => import("@/pages/TripDetail"));
const ChinaTrips = lazy(() => import("@/pages/ChinaTrips"));
const NewChinaTrip = lazy(() => import("@/pages/NewChinaTrip"));
const ChinaTripDetail = lazy(() => import("@/pages/ChinaTripDetail"));
const Profile = lazy(() => import("@/pages/Profile"));
const ImportKeep = lazy(() => import("@/pages/ImportKeep"));
const ImportTeams = lazy(() => import("@/pages/ImportTeams"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppModeProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route
                  element={
                    <ProtectedRoute>
                      <AppShell />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<Trips />} />
                  <Route path="/trips/new" element={<NewTrip />} />
                  <Route path="/trips/:id" element={<TripDetail />} />
                  <Route path="/china" element={<ChinaTrips />} />
                  <Route path="/china/new" element={<NewChinaTrip />} />
                  <Route path="/china/:id" element={<ChinaTripDetail />} />
                  <Route path="/search" element={<Navigate to="/" replace />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/import/keep" element={<ImportKeep />} />
                  <Route path="/import/teams" element={<ImportTeams />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

import { useState, useRef, useCallback } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAppMode, type AppMode } from "@/contexts/AppModeContext";
import { Home, Search, PlusCircle, User, LogOut, ChevronDown, Factory, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import SyncStatusIndicator from "@/components/SyncStatusIndicator";
import SearchOverlay from "./SearchOverlay";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { mode, setMode } = useAppMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const isChina = mode === "china_trip";
  const tripsLabel = isChina ? "Asia Trips" : "Str Trips";

  const handleTripsPointerDown = useCallback(() => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowModeMenu(true);
    }, 500);
  }, []);

  const handleTripsPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  if (!user) return null;

  const navItems = [
    { icon: Home, label: tripsLabel, path: isChina ? "/china" : "/", isTrips: true },
    { icon: Search, label: "Search", path: "__search__" },
    { icon: PlusCircle, label: "New", path: isChina ? "/china/new" : "/trips/new" },
    { icon: User, label: "Profile", path: "/profile" },
  ];

  function handleNavClick(path: string) {
    if (path === "__search__") {
      setSearchOpen((prev) => !prev);
    } else {
      setSearchOpen(false);
      navigate(path);
    }
  }

  function handleModeSwitch(newMode: AppMode) {
    setMode(newMode);
    setShowModeMenu(false);
    navigate(newMode === "china_trip" ? "/china" : "/");
  }

  const modeLabel = isChina ? "Asia Trip" : "Store Shopping";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* iPhone PWA safe-area spacer */}
      <div className="w-full bg-card md:bg-transparent" style={{ height: 'env(safe-area-inset-top, 0px)' }} />
      {/* Top bar - desktop */}
      <header className="hidden border-b bg-card md:block relative">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => { setSearchOpen(false); navigate(isChina ? "/china" : "/"); }} className="font-sans text-2xl font-semibold text-primary">
              CompShop
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                {modeLabel}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover">
                <DropdownMenuItem onClick={() => handleModeSwitch("store_shopping")} className="gap-2">
                  <Store className="h-4 w-4" /> Store Shopping
                  {!isChina && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleModeSwitch("china_trip")} className="gap-2">
                  <Factory className="h-4 w-4" /> Asia Trip
                  {isChina && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-3">
            <SyncStatusIndicator />
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavClick(item.path)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    (item.path === "__search__" && searchOpen) || (item.path !== "__search__" && location.pathname === item.path)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
              <button
                onClick={signOut}
                className="ml-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </nav>
          </div>
        </div>
        <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      </header>

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-4">
        <Outlet />
      </main>

      {/* Bottom nav - mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex flex-col">
          <SyncStatusIndicator />
          <div className="flex h-16 items-center justify-around">
            {navItems.map((item) => {
              const isTrips = (item as any).isTrips;
              const isActive = (item.path === "__search__" && searchOpen) || (item.path !== "__search__" && location.pathname === item.path);

              if (isTrips) {
                return (
                  <div key={item.path} className="relative">
                    <button
                      onPointerDown={handleTripsPointerDown}
                      onPointerUp={(e) => {
                        handleTripsPointerUp();
                        if (!longPressTriggered.current) {
                          handleNavClick(item.path);
                        }
                      }}
                      onPointerCancel={handleTripsPointerUp}
                      onContextMenu={(e) => e.preventDefault()}
                      className={cn(
                        "flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors select-none",
                        isActive ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="flex items-center gap-0.5">
                        {item.label}
                        <ChevronDown className="h-2.5 w-2.5" />
                      </span>
                    </button>
                    {/* Long-press mode menu */}
                    {showModeMenu && (
                      <>
                        <div className="fixed inset-0 z-50" onClick={() => setShowModeMenu(false)} />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md">
                          <button
                            onClick={() => handleModeSwitch("store_shopping")}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <Store className="h-4 w-4" /> Str Trips
                            {!isChina && <span className="ml-auto text-xs text-primary">✓</span>}
                          </button>
                          <button
                            onClick={() => handleModeSwitch("china_trip")}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <Factory className="h-4 w-4" /> Asia Trips
                            {isChina && <span className="ml-auto text-xs text-primary">✓</span>}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={item.path}
                  onClick={() => handleNavClick(item.path)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Mobile search overlay */}
      {searchOpen && (
        <div className="fixed inset-x-0 top-0 bottom-16 z-40 bg-card overflow-y-auto md:hidden">
          <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
        </div>
      )}
    </div>
  );
}

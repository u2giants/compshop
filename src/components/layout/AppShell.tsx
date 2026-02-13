import { useState } from "react";
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

  if (!user) return null;

  const isChina = mode === "china_trip";

  const navItems = [
    { icon: Home, label: isChina ? "China Trips" : "Trips", path: isChina ? "/china" : "/" },
    { icon: Search, label: "Search", path: "__search__" },
    { icon: PlusCircle, label: isChina ? "New Trip" : "New Trip", path: isChina ? "/china/new" : "/trips/new" },
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
    navigate(newMode === "china_trip" ? "/china" : "/");
  }

  const modeLabel = isChina ? "China Trip" : "Store Shopping";

  return (
    <div className="flex min-h-screen flex-col bg-background">
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
                  <Factory className="h-4 w-4" /> China Trip
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
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card md:hidden">
        <div className="flex flex-col">
          <SyncStatusIndicator />
          {/* Mode switcher strip */}
          <div className="flex items-center justify-center border-b px-4 py-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                {isChina ? <Factory className="h-3 w-3" /> : <Store className="h-3 w-3" />}
                {modeLabel}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="bg-popover">
                <DropdownMenuItem onClick={() => handleModeSwitch("store_shopping")} className="gap-2">
                  <Store className="h-4 w-4" /> Store Shopping
                  {!isChina && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleModeSwitch("china_trip")} className="gap-2">
                  <Factory className="h-4 w-4" /> China Trip
                  {isChina && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex h-16 items-center justify-around">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors",
                  (item.path === "__search__" && searchOpen) || (item.path !== "__search__" && location.pathname === item.path)
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </button>
            ))}
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

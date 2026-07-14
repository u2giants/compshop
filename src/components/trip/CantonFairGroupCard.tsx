import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar, MapPin, ChevronDown, ChevronRight, Plus, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import ChinaTripCard from "./ChinaTripCard";

export interface ChinaTripListItem {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
  date: string;
  end_date: string | null;
  parent_id: string | null;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_draft: boolean;
  photo_count?: number;
  cover_url?: string;
  cover_file_path?: string;
  photographer?: string | null;
}

interface CantonFairGroupCardProps {
  group: ChinaTripListItem;
  children: ChinaTripListItem[];
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onReclassified?: () => void;
}

// How many sub-trip cards to render before the "Show all" button. Keeping this
// small avoids a thundering herd of image loads when a large group is expanded —
// a fair with 60+ booths otherwise mounts every <img> at once and the grid blinks
// as they all decode together.
const INITIAL_VISIBLE = 12;

function venueBadgeLabel(type: string) {
  switch (type) {
    case "canton_fair": return "Canton Fair";
    case "booth_visit": return "Booth Visit";
    case "factory_visit": return "Factory Visit";
    default: return "Fair Trip";
  }
}

export default function CantonFairGroupCard({
  group,
  children,
  selectMode,
  selected,
  onToggleSelect,
  onReclassified,
}: CantonFairGroupCardProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const isSelected = selected.has(group.id);
  const totalPhotos = (group.photo_count ?? 0) + children.reduce((sum, c) => sum + (c.photo_count ?? 0), 0);

  // A "group" is a Canton Fair container (has a date range and/or holds sub-trips).
  // Everything else is a single fair trip that renders in the same row style but
  // navigates straight to its detail page instead of expanding.
  const isGroup = group.end_date != null || children.length > 0;
  const visibleChildren = showAll ? children : children.slice(0, INITIAL_VISIBLE);

  // ── Shared header row ─────────────────────────────────────────────────────
  const header = (
    <CardContent
      className="p-4 cursor-pointer"
      onClick={(e) => {
        if (selectMode) {
          e.preventDefault();
          onToggleSelect(group.id);
        } else if (!isGroup) {
          // Single trip: the whole row is a link to the trip detail.
          navigate(`/china/${group.id}`);
        }
      }}
    >
      <div className="flex items-center gap-3">
        {selectMode && (
          <Checkbox
            checked={isSelected}
            className="h-5 w-5 shrink-0 data-[state=checked]:bg-primary"
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={() => onToggleSelect(group.id)}
          />
        )}
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          {isGroup && open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-sans font-semibold truncate">{group.name || group.supplier}</span>
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-300 text-xs shrink-0">
              {isGroup ? "Canton Fair Group" : venueBadgeLabel(group.venue_type)}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(group.date), "MMM d")}
              {group.end_date && ` – ${format(new Date(group.end_date), "MMM d, yyyy")}`}
            </span>
            <span>{totalPhotos} photos</span>
            {isGroup && (
              <span>{children.length} sub-trip{children.length !== 1 ? "s" : ""}</span>
            )}
            {isGroup && totalPhotos > 0 && !selectMode && (
              <>
                <button
                  className="flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline font-medium"
                  onClick={(e) => { e.stopPropagation(); navigate(`/china/${group.id}/stream`); }}
                >
                  <Images className="h-3 w-3" /> View all photos
                </button>
                <button
                  className="flex items-center gap-1 text-primary hover:underline font-medium"
                  onClick={(e) => { e.stopPropagation(); navigate(`/china/${group.id}/stream-v2`); }}
                >
                  Faster view
                </button>
              </>
            )}
            {group.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {group.location}
              </span>
            )}
          </div>
        </div>
      </div>
    </CardContent>
  );

  // Never animate/shadow the entire expanded group. On large fairs that makes
  // Chrome re-composite a very tall surface whenever the pointer crosses it,
  // which can checkerboard or partially blank image tiles while scrolling.
  const cardClass = `border-l-4 border-l-amber-500 bg-amber-50/40 shadow-none dark:bg-amber-950/20 ${
    selectMode && isSelected ? "ring-2 ring-primary" : ""
  }`;

  // ── Single fair trip: no expansion, header links to detail ────────────────
  if (!isGroup) {
    return (
      <div className="col-span-full">
        <Card className={cardClass}>{header}</Card>
      </div>
    );
  }

  // ── Canton Fair group: collapsible with paginated sub-trips ───────────────
  return (
    <div className="col-span-full">
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card className={cardClass}>
          <CollapsibleTrigger asChild>{header}</CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-amber-200/50 dark:border-amber-800/30 px-4 pb-4 pt-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{children.length} sub-trip{children.length !== 1 ? "s" : ""}</span>
                {!selectMode && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
                        <Plus className="h-3 w-3" /> Add
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/china/new?type=booth_visit&parent=${group.id}`)}>
                        Booth Visit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/china/new?type=factory_visit&parent=${group.id}`)}>
                        Factory Visit
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleChildren.map((child) => (
                  <ChinaTripCard
                    key={child.id}
                    trip={child}
                    selectMode={selectMode}
                    isSelected={selected.has(child.id)}
                    onToggleSelect={onToggleSelect}
                    onClick={() => {
                      if (selectMode) onToggleSelect(child.id);
                      else navigate(`/china/${child.id}`);
                    }}
                    onReclassified={onReclassified}
                  />
                ))}
                {children.length === 0 && (
                  <p className="col-span-full text-sm text-muted-foreground py-2">
                    No sub-trips yet. Use the Add button above.
                  </p>
                )}
              </div>
              {children.length > INITIAL_VISIBLE && !showAll && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setShowAll(true)}
                  >
                    <ChevronDown className="h-3 w-3" /> Show all {children.length} sub-trips
                  </Button>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

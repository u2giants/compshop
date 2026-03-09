import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPin, Factory, User } from "lucide-react";
import { format } from "date-fns";
import type { ChinaTripListItem } from "./CantonFairGroupCard";

interface ChinaTripCardProps {
  trip: ChinaTripListItem;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onClick: () => void;
}

function venueLabel(type: string) {
  switch (type) {
    case "canton_fair": return "Canton Fair";
    case "booth_visit": return "Booth Visit";
    default: return "Factory";
  }
}

export default function ChinaTripCard({ trip, selectMode, isSelected, onToggleSelect, onClick }: ChinaTripCardProps) {
  const isBooth = trip.venue_type === "booth_visit";

  return (
    <Card
      className={`cursor-pointer overflow-hidden transition-shadow hover:shadow-md ${
        isBooth ? "border-l-4 border-l-violet-400 bg-violet-50/30 dark:bg-violet-950/15" : ""
      } ${selectMode && isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={onClick}
    >
      {trip.cover_url ? (
        <div className="relative h-36 w-full">
          <img src={trip.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          {selectMode && (
            <div className="absolute top-2 left-2">
              <Checkbox checked={isSelected} className="h-5 w-5 border-white bg-black/30 data-[state=checked]:bg-primary" />
            </div>
          )}
          {/* Photographer overlay */}
          {trip.photographer && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
              <User className="h-2.5 w-2.5" />
              {trip.photographer}
            </div>
          )}
        </div>
      ) : (
        <div className={`relative flex h-24 items-center justify-center ${isBooth ? "bg-violet-100/50 dark:bg-violet-900/20" : "bg-muted"}`}>
          <Factory className="h-8 w-8 text-muted-foreground/30" />
          {selectMode && (
            <div className="absolute top-2 left-2">
              <Checkbox checked={isSelected} className="h-5 w-5 data-[state=checked]:bg-primary" />
            </div>
          )}
        </div>
      )}
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-sans font-medium truncate">{trip.supplier}</span>
          <Badge variant="outline" className={`text-xs shrink-0 ${isBooth ? "border-violet-300 text-violet-700 dark:text-violet-300" : ""}`}>
            {venueLabel(trip.venue_type)}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{format(new Date(trip.date), "MMM d, yyyy")}</span>
          <span>·</span>
          <span>{trip.photo_count ?? 0} photos</span>
        </div>
        {/* Prominent photographer attribution */}
        {trip.photographer && !trip.cover_url && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{trip.photographer}</span>
          </div>
        )}
        {trip.location && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{trip.location}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

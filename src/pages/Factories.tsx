import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { batchSignedUrls } from "@/lib/photo-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Factory, Search, MapPin, Phone, Mail, MessageCircle, Globe, User, ImageIcon, Building2, Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";

interface FactoryItem {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  whatsapp: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
}

interface SupplierAgg {
  supplier: string;
  factory: FactoryItem | null;
  tripCount: number;
  photoCount: number;
  latestDate: string;
  coverUrl?: string;
  tripIds: string[];
  // per-trip details for date grouping
  trips: { id: string; date: string; photoCount: number; coverUrl?: string }[];
}

interface DateBucket {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  visits: { supplier: string; factory: FactoryItem | null; tripIds: string[]; photoCount: number; coverUrl?: string }[];
  totalPhotos: number;
}

type GroupMode = "factory" | "date";

export default function Factories() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<SupplierAgg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    return (localStorage.getItem("factories.groupMode") as GroupMode) || "factory";
  });

  useEffect(() => {
    localStorage.setItem("factories.groupMode", groupMode);
  }, [groupMode]);

  useEffect(() => {
    if (!user) return;
    loadFactories();
  }, [user]);

  async function loadFactories() {
    try {
      // Get all non-deleted china trips (excluding groups that have end_date)
      const { data: trips } = await supabase
        .from("china_trips")
        .select("id, supplier, date, factory_id, venue_type")
        .is("deleted_at", null)
        .eq("is_draft", false)
        .eq("venue_type", "factory_visit")
        .is("parent_id", null) // exclude children of Canton Fair groups
        .order("date", { ascending: false });

      if (!trips) { setLoading(false); return; }

      // Get all factories
      const { data: factories } = await supabase
        .from("factories")
        .select("*")
        .order("name");

      const factoryMap = new Map<string, FactoryItem>();
      (factories || []).forEach(f => factoryMap.set(f.id, f as FactoryItem));

      // Aggregate by supplier name (normalized)
      const supplierMap = new Map<string, { trips: typeof trips; factoryId: string | null }>();
      for (const trip of trips) {
        const key = trip.supplier.trim().toLowerCase();
        const existing = supplierMap.get(key);
        if (existing) {
          existing.trips.push(trip);
          if (!existing.factoryId && trip.factory_id) existing.factoryId = trip.factory_id;
        } else {
          supplierMap.set(key, { trips: [trip], factoryId: trip.factory_id });
        }
      }

      // Get photo counts per trip
      const tripIds = trips.map(t => t.id);
      const photoCountPromises = tripIds.map(tid =>
        supabase.from("china_photos").select("*", { count: "exact", head: true }).eq("trip_id", tid)
      );
      const coverPromises = tripIds.map(tid =>
        supabase.from("china_photos").select("file_path").eq("trip_id", tid).order("created_at", { ascending: true }).limit(1)
      );

      const [photoCounts, coverResults] = await Promise.all([
        Promise.all(photoCountPromises),
        Promise.all(coverPromises),
      ]);

      const tripPhotoCount = new Map<string, number>();
      const tripCoverPath = new Map<string, string>();
      tripIds.forEach((tid, i) => {
        tripPhotoCount.set(tid, photoCounts[i].count ?? 0);
        if (coverResults[i].data?.[0]?.file_path) {
          tripCoverPath.set(tid, coverResults[i].data![0].file_path);
        }
      });

      // Get signed URLs for covers
      const coverPaths = Array.from(tripCoverPath.values());
      const urlMap = await batchSignedUrls(coverPaths.map(fp => ({ file_path: fp })));

      // Build aggregated list
      const aggs: SupplierAgg[] = [];
      for (const [, { trips: supplierTrips, factoryId }] of supplierMap) {
        const totalPhotos = supplierTrips.reduce((sum, t) => sum + (tripPhotoCount.get(t.id) ?? 0), 0);
        const firstTrip = supplierTrips[0]; // already sorted desc
        const coverPath = supplierTrips.map(t => tripCoverPath.get(t.id)).find(Boolean);

        aggs.push({
          supplier: firstTrip.supplier,
          factory: factoryId ? factoryMap.get(factoryId) ?? null : null,
          tripCount: supplierTrips.length,
          photoCount: totalPhotos,
          latestDate: firstTrip.date,
          coverUrl: coverPath ? urlMap.get(coverPath) : undefined,
          tripIds: supplierTrips.map(t => t.id),
          trips: supplierTrips.map(t => {
            const cp = tripCoverPath.get(t.id);
            return {
              id: t.id,
              date: t.date,
              photoCount: tripPhotoCount.get(t.id) ?? 0,
              coverUrl: cp ? urlMap.get(cp) : undefined,
            };
          }),
        });
      }

      // Also add factories that have no trips yet
      for (const factory of (factories || [])) {
        const alreadyLinked = aggs.some(a => a.factory?.id === factory.id);
        if (!alreadyLinked) {
          aggs.push({
            supplier: factory.name,
            factory: factory as FactoryItem,
            tripCount: 0,
            photoCount: 0,
            latestDate: factory.created_at,
            tripIds: [],
            trips: [],
          });
        }
      }

      aggs.sort((a, b) => b.latestDate.localeCompare(a.latestDate));
      setSuppliers(aggs);
    } catch (err) {
      console.error("Error loading factories:", err);
    }
    setLoading(false);
  }

  const filtered = search
    ? suppliers.filter(s =>
        s.supplier.toLowerCase().includes(search.toLowerCase()) ||
        s.factory?.contact_person?.toLowerCase().includes(search.toLowerCase()) ||
        s.factory?.address?.toLowerCase().includes(search.toLowerCase())
      )
    : suppliers;

  return (
    <div className="container py-6">
      {/* Tabs navigation */}
      <div className="mb-4">
        <Tabs value="factories" onValueChange={(v) => v === "trips" && navigate("/china")}>
          <TabsList>
            <TabsTrigger value="trips" className="gap-1.5">
              <Factory className="h-4 w-4" /> Fair Trips
            </TabsTrigger>
            <TabsTrigger value="factories" className="gap-1.5">
              <Building2 className="h-4 w-4" /> Fty Visits
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mb-6">
        <h1 className="font-sans text-3xl md:text-4xl">Factory Visits</h1>
        <p className="mt-1 text-muted-foreground hidden md:block">All standalone factory visit trips</p>
      </div>

      {suppliers.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search factories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5">
                <div className="h-5 w-2/3 rounded bg-muted" />
                <div className="mt-3 h-4 w-1/2 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Factory className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="font-sans text-xl">{search ? "No matching factories" : "No factories yet"}</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {search
                ? "Try a different search term."
                : "Factories will appear here as you create Asia trips. Scan business cards to add contact details."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s, i) => (
            <Card
              key={i}
              className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
              onClick={() => navigate(`/china/factories/${encodeURIComponent(s.supplier)}`, { state: { tripIds: s.tripIds, factory: s.factory } })}
            >
              <CardContent className="p-0">
                {/* Cover image */}
                {s.coverUrl ? (
                  <div className="h-32 w-full overflow-hidden bg-muted">
                    <img src={s.coverUrl} alt={s.supplier} className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-muted/50">
                    <Factory className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}

                <div className="p-4 space-y-2">
                  <h3 className="font-sans font-semibold text-sm truncate">{s.supplier}</h3>

                  {/* Contact info from business card */}
                  {s.factory && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {s.factory.contact_person && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 shrink-0" /> {s.factory.contact_person}
                        </div>
                      )}
                      {s.factory.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 shrink-0" /> {s.factory.phone}
                        </div>
                      )}
                      {s.factory.email && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{s.factory.email}</span>
                        </div>
                      )}
                      {s.factory.wechat && (
                        <div className="flex items-center gap-1.5">
                          <MessageCircle className="h-3 w-3 shrink-0" /> WeChat: {s.factory.wechat}
                        </div>
                      )}
                      {s.factory.address && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{s.factory.address}</span>
                        </div>
                      )}
                      {s.factory.website && (
                        <div className="flex items-center gap-1.5">
                          <Globe className="h-3 w-3 shrink-0" /> <span className="truncate">{s.factory.website}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                    <span className="flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" /> {s.photoCount} photos
                    </span>
                    <span>{s.tripCount} trip{s.tripCount !== 1 ? "s" : ""}</span>
                    {s.factory && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Contact on file
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

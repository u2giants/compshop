import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto, getSignedPhotoUrl, PRODUCT_CATEGORIES } from "@/lib/supabase-helpers";
import {
  getCachedTrip,
  cacheTrips,
  getCachedPhotos,
  cachePhotos,
  cacheImageBlob,
  getCachedImageBlob,
  addPendingUpload,
  getPendingUploadsByTrip,
  type CachedPhoto,
  type PendingUpload,
} from "@/lib/offline-db";
import { runSync } from "@/lib/sync-service";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, Calendar, MapPin, Store, Users, CloudOff } from "lucide-react";
import { format } from "date-fns";
import PhotoCard from "@/components/trip/PhotoCard";
import TripMembers from "@/components/trip/TripMembers";

interface Trip {
  id: string;
  name: string;
  store: string;
  date: string;
  location: string | null;
  notes: string | null;
  created_by: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  product_name: string | null;
  category: string | null;
  price: number | null;
  dimensions: string | null;
  country_of_origin: string | null;
  material: string | null;
  brand: string | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  signed_url?: string;
}

export default function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadTrip();
    loadPhotos();
    loadPendingPhotos();

    if (!online) return;

    const channel = supabase
      .channel(`trip-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: `trip_id=eq.${id}` }, () => loadPhotos())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, online]);

  async function loadTrip() {
    // Cache first
    const cached = await getCachedTrip(id!);
    if (cached) {
      setTrip(cached);
      setLoading(false);
    }

    if (!navigator.onLine) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase.from("shopping_trips").select("*").eq("id", id!).single();
      if (data) {
        setTrip(data);
        await cacheTrips([data as any]);
      }
    } catch (err) {
      console.error("[TripDetail] Network error loading trip", err);
    }
    setLoading(false);
  }

  async function loadPhotos() {
    // Cache first
    const cached = await getCachedPhotos(id!);
    if (cached.length > 0) {
      // Resolve cached image blobs for offline URLs
      const withUrls = await Promise.all(
        cached.map(async (p) => {
          if (p.signed_url) return p;
          const blob = await getCachedImageBlob(p.file_path);
          return { ...p, signed_url: blob ? URL.createObjectURL(blob) : undefined };
        })
      );
      setPhotos(withUrls as Photo[]);
    }

    if (!navigator.onLine) return;

    try {
      const { data } = await supabase
        .from("photos")
        .select("*")
        .eq("trip_id", id!)
        .order("created_at", { ascending: false });

      if (data) {
        const withUrls = await Promise.all(
          data.map(async (p) => {
            try {
              const signed_url = await getSignedPhotoUrl(p.file_path);
              // Cache the image blob in background
              cacheImageInBackground(p.file_path, signed_url);
              return { ...p, signed_url };
            } catch {
              return { ...p, signed_url: undefined };
            }
          })
        );
        setPhotos(withUrls);
        await cachePhotos(data as CachedPhoto[]);
      }
    } catch (err) {
      console.error("[TripDetail] Network error loading photos", err);
    }
  }

  async function cacheImageInBackground(filePath: string, url: string) {
    try {
      const existing = await getCachedImageBlob(filePath);
      if (existing) return; // already cached
      const res = await fetch(url);
      const blob = await res.blob();
      await cacheImageBlob(filePath, blob);
    } catch {
      // non-critical
    }
  }

  async function loadPendingPhotos() {
    if (!id) return;
    const pending = await getPendingUploadsByTrip(id);
    setPendingPhotos(pending);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setShowUploadDialog(true);
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedFile || !user || !id || !formRef.current) return;
    setUploading(true);

    const form = new FormData(formRef.current);
    const metadata = {
      product_name: (form.get("product_name") as string) || null,
      category: (form.get("category") as string) || null,
      price: form.get("price") ? Number(form.get("price")) : null,
      dimensions: (form.get("dimensions") as string) || null,
      country_of_origin: (form.get("country_of_origin") as string) || null,
      material: (form.get("material") as string) || null,
      brand: (form.get("brand") as string) || null,
      notes: (form.get("notes") as string) || null,
    };

    if (!navigator.onLine) {
      // Save to pending queue
      const pendingId = crypto.randomUUID();
      await addPendingUpload({
        id: pendingId,
        trip_id: id,
        file_blob: selectedFile,
        file_name: selectedFile.name,
        metadata,
        user_id: user.id,
        created_at: new Date().toISOString(),
        status: "pending",
        retry_count: 0,
      });

      toast({ title: "Saved offline", description: "Photo will upload when you're back online." });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploading(false);
      loadPendingPhotos();
      return;
    }

    try {
      const filePath = await uploadPhoto(selectedFile, user.id, id);
      const { error } = await supabase.from("photos").insert({
        trip_id: id,
        user_id: user.id,
        file_path: filePath,
        ...metadata,
      });

      if (error) throw error;
      toast({ title: "Photo uploaded!" });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      loadPhotos();
    } catch (err: any) {
      // If upload fails, save to pending queue
      const pendingId = crypto.randomUUID();
      await addPendingUpload({
        id: pendingId,
        trip_id: id,
        file_blob: selectedFile,
        file_name: selectedFile.name,
        metadata,
        user_id: user.id,
        created_at: new Date().toISOString(),
        status: "pending",
        retry_count: 0,
      });
      toast({ title: "Saved for later sync", description: "Upload failed, but your photo is saved locally." });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      loadPendingPhotos();
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="container py-6"><div className="h-8 w-48 animate-pulse rounded bg-muted" /></div>;
  if (!trip) return <div className="container py-6">Trip not found</div>;

  return (
    <div className="container py-6">
      <button onClick={() => navigate("/")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All Trips
      </button>

      {/* Trip header */}
      <div className="mb-6">
        <h1 className="font-serif text-2xl md:text-3xl">{trip.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Store className="h-3.5 w-3.5" /> {trip.store}</span>
          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {format(new Date(trip.date), "MMM d, yyyy")}</span>
          {trip.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {trip.location}</span>}
        </div>
        {trip.notes && <p className="mt-2 text-sm text-muted-foreground">{trip.notes}</p>}
      </div>

      {/* Trip members */}
      <TripMembers tripId={trip.id} createdBy={trip.created_by} />

      {/* Action bar */}
      <div className="mb-6 flex items-center gap-3">
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
        <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
          <Camera className="h-4 w-4" /> Add Photo
        </Button>
        <Badge variant="secondary">{photos.length} photos</Badge>
        {pendingPhotos.length > 0 && (
          <Badge variant="outline" className="gap-1">
            <CloudOff className="h-3 w-3" /> {pendingPhotos.length} pending
          </Badge>
        )}
      </div>

      {/* Upload dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">Add Photo Details</DialogTitle>
            {!online && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <CloudOff className="h-3 w-3" /> Offline — photo will sync when connected
              </p>
            )}
          </DialogHeader>
          <form ref={formRef} onSubmit={handleUpload} className="space-y-4">
            {previewUrl && (
              <img src={previewUrl} alt="Preview" className="max-h-48 w-full rounded-lg object-cover" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="product_name">Product Name</Label>
                <Input id="product_name" name="product_name" placeholder="e.g. Ceramic Table Lamp" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select name="category">
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Price</Label>
                <Input id="price" name="price" type="number" step="0.01" placeholder="$0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand">Brand</Label>
                <Input id="brand" name="brand" placeholder="Brand name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dimensions">Size/Dimensions</Label>
                <Input id="dimensions" name="dimensions" placeholder='e.g. 12"x8"' />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country_of_origin">Made In</Label>
                <Input id="country_of_origin" name="country_of_origin" placeholder="Country" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="material">Material</Label>
                <Input id="material" name="material" placeholder="e.g. Ceramic, Wood" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" placeholder="Additional observations..." rows={2} />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={uploading}>
              {uploading ? "Saving..." : online ? "Save Photo" : "Save Offline"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pending uploads */}
      {pendingPhotos.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CloudOff className="h-3 w-3" /> Pending uploads (will sync when online)
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pendingPhotos.map((p) => {
              const blobUrl = URL.createObjectURL(p.file_blob);
              return (
                <Card key={p.id} className="overflow-hidden border-dashed opacity-75">
                  <img src={blobUrl} alt="Pending" className="h-40 w-full object-cover" />
                  <CardContent className="p-3">
                    <p className="text-sm font-medium">{p.metadata.product_name || "Untitled"}</p>
                    <Badge variant="outline" className="mt-1 text-xs">{p.status}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Photo grid */}
      {photos.length === 0 && pendingPhotos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Camera className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No photos yet. Tap "Add Photo" to capture your first find.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo) => (
            <PhotoCard key={photo.id} photo={photo} onUpdated={loadPhotos} />
          ))}
        </div>
      )}
    </div>
  );
}

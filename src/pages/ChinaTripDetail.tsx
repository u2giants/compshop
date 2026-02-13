import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto, getSignedPhotoUrl, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import { useCategories } from "@/hooks/use-categories";
import { useCountries } from "@/hooks/use-countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, Calendar, MapPin, Factory, Sparkles, Loader2, Download } from "lucide-react";
import { format } from "date-fns";
import PhotoCard from "@/components/trip/PhotoCard";
import AutocompleteInput from "@/components/ui/autocomplete-input";

interface ChinaTrip {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
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
  image_type: string | null;
  user_id: string | null;
  created_at: string;
  signed_url?: string;
  group_id: string | null;
}

function groupPhotos(photos: Photo[]): { primary: Photo; extras: Photo[] }[] {
  const grouped = new Map<string, Photo[]>();
  const primaries: Photo[] = [];
  for (const p of photos) {
    if (p.group_id) {
      const list = grouped.get(p.group_id) || [];
      list.push(p);
      grouped.set(p.group_id, list);
    } else {
      primaries.push(p);
    }
  }
  return primaries.map((p) => ({ primary: p, extras: grouped.get(p.id) || [] }));
}

export default function ChinaTripDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const countries = useCountries();
  const categories = useCategories();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [trip, setTrip] = useState<ChinaTrip | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [countryValue, setCountryValue] = useState("");
  const [formFields, setFormFields] = useState({
    product_name: "", category: "", price: "", brand: "", dimensions: "", material: "", notes: "",
  });

  useEffect(() => {
    if (!id) return;
    loadTrip();
    loadPhotos();

    const channel = supabase
      .channel(`china-trip-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "china_photos", filter: `trip_id=eq.${id}` }, () => loadPhotos())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function loadTrip() {
    try {
      const { data } = await supabase.from("china_trips").select("*").eq("id", id!).single();
      if (data) setTrip(data);
    } catch (err) { console.error("Error loading china trip", err); }
    setLoading(false);
  }

  async function loadPhotos() {
    try {
      const { data } = await supabase.from("china_photos").select("*").eq("trip_id", id!).order("created_at", { ascending: false });
      if (data) {
        const withUrls = await Promise.all(
          data.map(async (p) => {
            try {
              const signed_url = await getSignedPhotoUrl(p.file_path);
              return { ...p, signed_url };
            } catch { return { ...p, signed_url: undefined }; }
          })
        );
        setPhotos(withUrls);
      }
    } catch (err) { console.error("Error loading china photos", err); }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      setSelectedFile(files[0]);
      setPreviewUrl(URL.createObjectURL(files[0]));
      setFormFields({ product_name: "", category: "", price: "", brand: "", dimensions: "", material: "", notes: "" });
      setCountryValue("");
      setShowUploadDialog(true);
    } else {
      handleBulkUpload(Array.from(files));
    }
  }

  async function handleBulkUpload(files: File[]) {
    if (!user || !id) return;
    setUploading(true);
    let successCount = 0;
    for (const file of files) {
      try {
        const fileHash = await hashFile(file);
        if (await checkDuplicatePhoto(fileHash)) continue;
        const filePath = await uploadPhoto(file, user.id, id);
        await supabase.from("china_photos").insert({ trip_id: id, user_id: user.id, file_path: filePath, file_hash: fileHash });
        successCount++;
      } catch {}
    }
    setUploading(false);
    toast({ title: `${successCount} photo${successCount !== 1 ? "s" : ""} uploaded` });
    loadPhotos();
  }

  async function handleAnalyze() {
    if (!selectedFile) return;
    setAnalyzing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      const { data, error } = await supabase.functions.invoke("analyze-photo", {
        body: { imageBase64: base64, mimeType: selectedFile.type },
      });
      if (error) throw error;
      if (data.product_name) setFormFields((f) => ({ ...f, product_name: data.product_name }));
      if (data.price != null) setFormFields((f) => ({ ...f, price: String(data.price) }));
      if (data.dimensions) setFormFields((f) => ({ ...f, dimensions: data.dimensions }));
      if (data.brand) setFormFields((f) => ({ ...f, brand: data.brand }));
      if (data.material) setFormFields((f) => ({ ...f, material: data.material }));
      if (data.country_of_origin) setCountryValue(data.country_of_origin);
      toast({ title: "AI detection complete" });
    } catch (err: any) {
      toast({ title: "AI detection failed", description: err.message, variant: "destructive" });
    }
    setAnalyzing(false);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile || !user || !id) return;
    setUploading(true);
    try {
      const fileHash = await hashFile(selectedFile);
      if (await checkDuplicatePhoto(fileHash)) {
        toast({ title: "Duplicate photo", description: "This photo has already been uploaded.", variant: "destructive" });
        setUploading(false);
        return;
      }
      const filePath = await uploadPhoto(selectedFile, user.id, id);
      await supabase.from("china_photos").insert({
        trip_id: id, user_id: user.id, file_path: filePath, file_hash: fileHash,
        product_name: formFields.product_name || null,
        category: formFields.category || null,
        price: formFields.price ? parseFloat(formFields.price) : null,
        brand: formFields.brand || null,
        dimensions: formFields.dimensions || null,
        material: formFields.material || null,
        notes: formFields.notes || null,
        country_of_origin: countryValue || null,
      });
      toast({ title: "Photo uploaded!" });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      loadPhotos();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  }

  async function handlePhotoUpdate(photoId: string, updates: Partial<Photo>) {
    const { error } = await supabase.from("china_photos").update(updates).eq("id", photoId);
    if (error) { toast({ title: "Update failed", variant: "destructive" }); return; }
    loadPhotos();
  }

  async function handlePhotoDelete(photoId: string) {
    const { error } = await supabase.from("china_photos").delete().eq("id", photoId);
    if (error) { toast({ title: "Delete failed", variant: "destructive" }); return; }
    toast({ title: "Photo deleted" });
    loadPhotos();
  }

  async function handleGroupPhoto(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const { error } = await supabase.from("china_photos").update({ group_id: targetId }).eq("id", draggedId);
    if (error) { toast({ title: "Grouping failed", variant: "destructive" }); return; }
    toast({ title: "Photos grouped" });
    loadPhotos();
  }

  const groups = groupPhotos(photos);

  if (loading) {
    return (
      <div className="container py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="container py-6 text-center">
        <p className="text-muted-foreground">Trip not found</p>
        <Button onClick={() => navigate("/")} className="mt-4">Back to Trips</Button>
      </div>
    );
  }

  return (
    <div className="container py-6">
      <button onClick={() => navigate("/")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Trip header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Factory className="h-6 w-6 text-primary shrink-0" />
          <h1 className="font-sans text-2xl md:text-3xl font-semibold">{trip.supplier}</h1>
          <Badge variant="outline">{trip.venue_type === "canton_fair" ? "Canton Fair" : "Factory Visit"}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{format(new Date(trip.date), "MMMM d, yyyy")}</span>
          {trip.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{trip.location}</span>}
          <span>{photos.length} photos</span>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {uploading ? "Uploading..." : "Add Photos"}
        </Button>
      </div>

      {/* Photos grid */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Camera className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="font-sans text-xl">No photos yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Add photos from this supplier visit.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map(({ primary, extras }) => (
            <PhotoCard
              key={primary.id}
              photo={primary}
              extraPhotos={extras}
              tripId={id}
              onUpdated={loadPhotos}
              onGroupPhoto={handleGroupPhoto}
              onFileDrop={(files, targetId) => {
                if (!user || !id) return;
                files.forEach(async (file) => {
                  const fileHash = await hashFile(file);
                  if (await checkDuplicatePhoto(fileHash)) return;
                  const filePath = await uploadPhoto(file, user.id, id);
                  await supabase.from("china_photos").insert({
                    trip_id: id, user_id: user.id, file_path: filePath, file_hash: fileHash, group_id: targetId,
                  });
                });
                setTimeout(loadPhotos, 1000);
              }}
            />
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-sans">Add Photo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4">
            {previewUrl && (
              <img src={previewUrl} alt="Preview" className="w-full rounded-md object-contain" style={{ maxHeight: "40vh" }} />
            )}
            <Button type="button" variant="outline" onClick={handleAnalyze} disabled={analyzing} className="w-full gap-2">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? "Detecting..." : "AI Detect"}
            </Button>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Product Name</Label>
                <Input value={formFields.product_name} onChange={(e) => setFormFields((f) => ({ ...f, product_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={formFields.category} onValueChange={(v) => setFormFields((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price</Label>
                <Input type="number" step="0.01" value={formFields.price} onChange={(e) => setFormFields((f) => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Brand</Label>
                <Input value={formFields.brand} onChange={(e) => setFormFields((f) => ({ ...f, brand: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dimensions</Label>
                <Input value={formFields.dimensions} onChange={(e) => setFormFields((f) => ({ ...f, dimensions: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Made In</Label>
                <AutocompleteInput value={countryValue} onChange={setCountryValue} suggestions={countries} placeholder="—" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Material</Label>
              <Input value={formFields.material} onChange={(e) => setFormFields((f) => ({ ...f, material: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={formFields.notes} onChange={(e) => setFormFields((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <Button type="submit" className="w-full" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload Photo"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

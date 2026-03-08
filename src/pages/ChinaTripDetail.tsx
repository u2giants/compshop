import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import { groupPhotos, groupBySection, batchSignedUrls } from "@/lib/photo-utils";
import type { Photo, ChinaTrip } from "@/types/models";
import { extractExif } from "@/lib/exif-utils";
import { isInAmericas } from "@/lib/geo-utils";
import { useCategories } from "@/hooks/use-categories";
import { useCountries } from "@/hooks/use-countries";
import { useOnlineStatus } from "@/hooks/use-online-status";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Camera, Calendar, MapPin, Factory, Sparkles, Loader2, Download,
  Images, ArrowRightLeft, PenLine, Pencil, CalendarIcon, CloudOff, Plus, LayoutGrid, Layers,
} from "lucide-react";
import { format } from "date-fns";
import PhotoCard from "@/components/trip/PhotoCard";
import ChinaMoveToTripDialog from "@/components/trip/ChinaMoveToTripDialog";
import BulkEditDialog from "@/components/trip/BulkEditDialog";
import AutocompleteInput from "@/components/ui/autocomplete-input";

// ChinaTrip, Photo types imported from @/types/models
// groupPhotos, groupBySection imported from @/lib/photo-utils

export default function ChinaTripDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const countries = useCountries();
  const categories = useCategories();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [trip, setTrip] = useState<ChinaTrip | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [countryValue, setCountryValue] = useState("");
  const [userProfiles, setUserProfiles] = useState<Record<string, string>>({});
  const [formFields, setFormFields] = useState({
    product_name: "", category: "", price: "", brand: "", dimensions: "", material: "", notes: "",
  });
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const lastSelectedPhotoRef = useRef<string | null>(null);
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [viewAllMode, setViewAllMode] = useState(false);

  // Inline editing state
  const [editingSupplier, setEditingSupplier] = useState(false);
  const [supplierValue, setSupplierValue] = useState("");

  // Section management
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [emptySections, setEmptySections] = useState<string[]>([]);

  // Location resolution state
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<{ name: string; address: string }[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationEditValue, setLocationEditValue] = useState("");

  const existingSections = [...new Set([
    ...photos.filter((p) => p.section).map((p) => p.section!),
    ...emptySections,
  ])];

  // Flat ordered list of primary photo IDs for shift-click range selection
  const allGroups = groupPhotos(photos);
  const flatPrimaryIds = allGroups.map(g => g.primary.id);

  function toggleSelectPhoto(photoId: string, event?: React.MouseEvent) {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (event?.shiftKey && lastSelectedPhotoRef.current && lastSelectedPhotoRef.current !== photoId) {
        const startIdx = flatPrimaryIds.indexOf(lastSelectedPhotoRef.current);
        const endIdx = flatPrimaryIds.indexOf(photoId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = from; i <= to; i++) {
            next.add(flatPrimaryIds[i]);
          }
          return next;
        }
      }
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
      return next;
    });
    lastSelectedPhotoRef.current = photoId;
  }

  // ── Download All with file renaming ──
  function buildFileName(photo: Photo, indexInGroup?: number): string {
    const ext = photo.file_path.split(".").pop() || "jpg";
    const dateStr = trip?.date || photo.created_at;
    const d = new Date(dateStr);
    const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const supplierName = (trip?.supplier || "Supplier").replace(/[^a-zA-Z0-9]/g, "");
    const desc = (photo.product_name || "Photo").replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "");
    const suffix = indexInGroup && indexInGroup > 1 ? `_${indexInGroup}` : "";
    return `${yyyymmdd}_${supplierName}_${desc}${suffix}.${ext}`;
  }

  async function handleDownloadAll() {
    if (photos.length === 0) return;
    setDownloading(true);
    let count = 0;
    const groups = groupPhotos(photos);
    const downloadList: { photo: Photo; fileName: string }[] = [];
    for (const { primary, extras } of groups) {
      downloadList.push({ photo: primary, fileName: buildFileName(primary, 1) });
      extras.forEach((ex, i) => {
        downloadList.push({ photo: ex, fileName: buildFileName(primary, i + 2) });
      });
    }
    for (const { photo, fileName } of downloadList) {
      try {
        const url = photo.signed_url;
        if (!url) continue;
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        count++;
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error("Download failed for:", photo.id, err);
      }
    }
    setDownloading(false);
    toast({ title: `Downloaded ${count} photos` });
  }

  // ── Bulk AI Detect ──
  async function handleBulkAiDetect() {
    const photosWithoutMeta = photos.filter(
      (p) => !p.product_name && !p.brand && !p.price && p.signed_url
    );
    if (photosWithoutMeta.length === 0) {
      toast({ title: "All photos already have metadata" });
      return;
    }
    setBulkAnalyzing(true);
    setBulkAnalyzeProgress(0);
    let success = 0;
    for (let i = 0; i < photosWithoutMeta.length; i++) {
      const photo = photosWithoutMeta[i];
      setBulkAnalyzeProgress(Math.round((i / photosWithoutMeta.length) * 100));
      try {
        const res = await fetch(photo.signed_url!);
        const blob = await res.blob();
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const { data, error } = await supabase.functions.invoke("analyze-photo", {
          body: { imageBase64: base64, mimeType: blob.type, categories },
        });
        if (error) continue;
        const updates: Record<string, unknown> = {};
        if (data.product_name) updates.product_name = data.product_name;
        if (data.category) updates.category = data.category;
        if (data.price != null) updates.price = data.price;
        if (data.dimensions) updates.dimensions = data.dimensions;
        if (data.brand) updates.brand = data.brand;
        if (data.material) updates.material = data.material;
        if (data.country_of_origin) updates.country_of_origin = data.country_of_origin;
        if (Object.keys(updates).length > 0) {
          await supabase.from("china_photos").update(updates).eq("id", photo.id);
          success++;
        }
      } catch (err) {
        console.error("Bulk AI detect failed for:", photo.id, err);
      }
    }
    setBulkAnalyzeProgress(100);
    setBulkAnalyzing(false);
    toast({ title: "Bulk AI detection complete", description: `${success} of ${photosWithoutMeta.length} photos updated.` });
    loadPhotos();
  }

  // ── Assign selected photos to a section ──
  async function handleAssignSection(sectionName: string) {
    if (selectedPhotos.size === 0) return;
    const ids = Array.from(selectedPhotos);
    const { error } = await supabase.from("china_photos").update({ section: sectionName }).in("id", ids);
    if (error) {
      toast({ title: "Failed to assign section", variant: "destructive" });
      return;
    }
    toast({ title: `${ids.length} photo(s) moved to "${sectionName}"` });
    setSelectedPhotos(new Set());
    loadPhotos();
  }

  async function handleAddSection() {
    const name = newSectionName.trim();
    if (!name) return;
    if (selectedPhotos.size > 0) {
      await handleAssignSection(name);
    } else {
      // Add empty section placeholder so it appears as a drop target
      setEmptySections((prev) => prev.includes(name) ? prev : [...prev, name]);
      toast({ title: `Section "${name}" created`, description: "Drag photos into it to organize." });
    }
    setNewSectionName("");
    setShowAddSection(false);
  }

  // Auto-join user as china trip member if not already
  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data } = await supabase
        .from("china_trip_members")
        .select("id")
        .eq("trip_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) {
        await supabase.from("china_trip_members").insert({ trip_id: id, user_id: user.id });
      }
    })();
  }, [id, user]);

  // ── Data loading with offline support ──
  useEffect(() => {
    if (!id) return;
    loadTrip();
    loadPhotos();
    loadPendingPhotos();

    if (!online) return;

    const channel = supabase
      .channel(`china-trip-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "china_photos", filter: `trip_id=eq.${id}` }, () => loadPhotos())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, online]);

  async function loadTrip() {
    // Try cached first
    const cached = await getCachedTrip(id!);
    if (cached) { setTrip(cached as any); setLoading(false); }
    if (!navigator.onLine) { setLoading(false); return; }
    try {
      const { data } = await supabase.from("china_trips").select("*").eq("id", id!).single();
      if (data) {
        setTrip(data);
        await cacheTrips([{ id: data.id, name: data.name, store: data.supplier, date: data.date, location: data.location, notes: data.notes, created_by: data.created_by, created_at: data.created_at, updated_at: data.updated_at }]);
      }
    } catch (err) { console.error("Error loading china trip", err); }
    setLoading(false);
  }

  async function loadPhotos() {
    const cached = await getCachedPhotos(id!);
    if (cached.length > 0) {
      const withUrls = await Promise.all(
        cached.map(async (p) => {
          if (p.signed_url) return p;
          const blob = await getCachedImageBlob(p.file_path);
          return { ...p, signed_url: blob ? URL.createObjectURL(blob) : undefined };
        })
      );
      setPhotos(withUrls as unknown as Photo[]);
    }
    if (!navigator.onLine) return;
    try {
      const { data } = await supabase.from("china_photos").select("*").eq("trip_id", id!).order("created_at", { ascending: false });
      if (data) {
        // Batch signed URL generation (single API call instead of N)
        const urlMap = await batchSignedUrls(data);
        const withUrls = data.map((p) => {
          const signed_url = urlMap.get(p.file_path);
          if (signed_url) cacheImageInBackground(p.file_path, signed_url);
          return { ...p, signed_url };
        });
        setPhotos(withUrls as Photo[]);
        await cachePhotos(data as unknown as CachedPhoto[]);
        // Fetch user profiles for attribution
        const userIds = [...new Set(data.map(p => p.user_id).filter(Boolean))] as string[];
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from("profiles").select("id, display_name, email").in("id", userIds);
          if (profiles) {
            const map: Record<string, string> = {};
            profiles.forEach(p => { map[p.id] = p.display_name || p.email || "Unknown"; });
            setUserProfiles(prev => ({ ...prev, ...map }));
          }
        }
      }
    } catch (err) { console.error("Error loading china photos", err); }
  }

  async function cacheImageInBackground(filePath: string, url: string) {
    try {
      const existing = await getCachedImageBlob(filePath);
      if (existing) return;
      const res = await fetch(url);
      const blob = await res.blob();
      await cacheImageBlob(filePath, blob);
    } catch {}
  }

  async function loadPendingPhotos() {
    if (!id) return;
    const pending = await getPendingUploadsByTrip(id);
    setPendingPhotos(pending);
  }

  // Geo-fence state
  const [geoWarningFiles, setGeoWarningFiles] = useState<File[]>([]);
  const [showGeoWarning, setShowGeoWarning] = useState(false);
  const [geoWarningType, setGeoWarningType] = useState<"single" | "bulk">("single");

  async function checkGeoFence(files: File[]): Promise<{ ok: File[]; warned: File[] }> {
    const ok: File[] = [];
    const warned: File[] = [];
    for (const file of files) {
      const exif = await extractExif(file);
      if (exif.latitude != null && exif.longitude != null && isInAmericas(exif.latitude, exif.longitude)) {
        warned.push(file);
      } else {
        ok.push(file);
      }
    }
    return { ok, warned };
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      const file = files[0];
      extractExif(file).then((exif) => {
        if (exif.latitude != null && exif.longitude != null && isInAmericas(exif.latitude, exif.longitude)) {
          setGeoWarningFiles([file]);
          setGeoWarningType("single");
          setShowGeoWarning(true);
        } else {
          openSingleUpload(file);
        }
      });
    } else {
      const fileArray = Array.from(files);
      checkGeoFence(fileArray).then(({ ok, warned }) => {
        if (warned.length > 0 && ok.length === 0) {
          setGeoWarningFiles(warned);
          setGeoWarningType("bulk");
          setShowGeoWarning(true);
        } else if (warned.length > 0) {
          handleBulkUpload(ok);
          setGeoWarningFiles(warned);
          setGeoWarningType("bulk");
          setShowGeoWarning(true);
        } else {
          handleBulkUpload(ok);
        }
      });
    }
  }

  function openSingleUpload(file: File) {
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setFormFields({ product_name: "", category: "", price: "", brand: "", dimensions: "", material: "", notes: "" });
    setCountryValue("");
    setShowUploadDialog(true);
  }

  function handleGeoWarningContinue() {
    setShowGeoWarning(false);
    if (geoWarningType === "single" && geoWarningFiles.length === 1) {
      openSingleUpload(geoWarningFiles[0]);
    } else {
      handleBulkUpload(geoWarningFiles);
    }
    setGeoWarningFiles([]);
  }

  function handleGeoWarningCancel() {
    setShowGeoWarning(false);
    setGeoWarningFiles([]);
    toast({ title: "Upload cancelled", description: "Photos with US GPS coordinates were not uploaded." });
  }

  async function handleBulkUpload(files: File[]) {
    if (!user || !id) return;
    setUploading(true);
    let successCount = 0;
    let dupCount = 0;
    let pendingCount = 0;
    for (const file of files) {
      try {
        const fileHash = await hashFile(file);
        if (await checkDuplicatePhoto(fileHash)) { dupCount++; continue; }
        const filePath = await uploadPhoto(file, user.id, id);
        await supabase.from("china_photos").insert({ trip_id: id, user_id: user.id, file_path: filePath, file_hash: fileHash });
        successCount++;
      } catch {
        const pendingId = crypto.randomUUID();
        await addPendingUpload({
          id: pendingId, trip_id: id, file_blob: file, file_name: file.name,
          metadata: { product_name: null, category: null, price: null, dimensions: null, country_of_origin: null, material: null, brand: null, notes: null },
          user_id: user.id, created_at: new Date().toISOString(), status: "pending", retry_count: 0,
        });
        pendingCount++;
      }
    }
    setUploading(false);
    const parts: string[] = [];
    if (successCount > 0) parts.push(`${successCount} uploaded`);
    if (dupCount > 0) parts.push(`${dupCount} duplicates skipped`);
    if (pendingCount > 0) parts.push(`${pendingCount} queued for sync`);
    toast({
      title: `Bulk upload complete`,
      description: `${parts.join(", ")}.`,
    });
    loadPhotos();
    loadPendingPhotos();
    if (pendingCount > 0) runSync();
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
        body: { imageBase64: base64, mimeType: selectedFile.type, categories },
      });
      if (error) throw error;
      if (data.product_name) setFormFields((f) => ({ ...f, product_name: data.product_name }));
      if (data.category) setFormFields((f) => ({ ...f, category: data.category }));
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

    const metadata = {
      product_name: formFields.product_name || null,
      category: formFields.category || null,
      price: formFields.price ? parseFloat(formFields.price) : null,
      brand: formFields.brand || null,
      dimensions: formFields.dimensions || null,
      material: formFields.material || null,
      notes: formFields.notes || null,
      country_of_origin: countryValue || null,
    };

    if (!navigator.onLine) {
      const pendingId = crypto.randomUUID();
      await addPendingUpload({
        id: pendingId, trip_id: id, file_blob: selectedFile, file_name: selectedFile.name,
        metadata, user_id: user.id, created_at: new Date().toISOString(), status: "pending", retry_count: 0,
      });
      toast({ title: "Saved offline", description: "Photo will upload when you're back online." });
      setShowUploadDialog(false); setSelectedFile(null); setPreviewUrl(null); setUploading(false);
      loadPendingPhotos();
      return;
    }

    try {
      const fileHash = await hashFile(selectedFile);
      if (await checkDuplicatePhoto(fileHash)) {
        toast({ title: "Duplicate photo", description: "Already uploaded.", variant: "destructive" });
        setUploading(false);
        return;
      }
      const filePath = await uploadPhoto(selectedFile, user.id, id);
      await supabase.from("china_photos").insert({
        trip_id: id, user_id: user.id, file_path: filePath, file_hash: fileHash, ...metadata,
      });
      toast({ title: "Photo uploaded!" });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      loadPhotos();
    } catch (err: any) {
      // Save offline on failure
      const pendingId = crypto.randomUUID();
      await addPendingUpload({
        id: pendingId, trip_id: id, file_blob: selectedFile, file_name: selectedFile.name,
        metadata, user_id: user.id, created_at: new Date().toISOString(), status: "pending", retry_count: 0,
      });
      toast({ title: "Saved for later sync", description: "Upload failed, photo saved locally." });
      setShowUploadDialog(false); setSelectedFile(null); setPreviewUrl(null);
      loadPendingPhotos();
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
  const sectionedGroups = (() => {
    const base = groupBySection(groups);
    // Add empty sections that don't have photos yet
    const existingInGroups = new Set(base.map(g => g.section));
    const emptyOnes = emptySections.filter(s => !existingInGroups.has(s));
    return [...base, ...emptyOnes.map(s => ({ section: s, items: [] as { primary: Photo; extras: Photo[] }[] }))];
  })();

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
        <Button onClick={() => navigate("/china")} className="mt-4">Back to Asia Trips</Button>
      </div>
    );
  }

  return (
    <div className="container py-6">
      <button onClick={() => navigate("/china")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Asia Trips
      </button>

      {/* Trip header with inline editing */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Factory className="h-6 w-6 text-primary shrink-0" />
          {editingSupplier ? (
            <div className="flex items-center gap-2">
              <Input
                value={supplierValue}
                onChange={(e) => setSupplierValue(e.target.value)}
                className="text-lg font-semibold"
                autoFocus
              />
              <Button size="sm" onClick={async () => {
                if (!supplierValue.trim()) return;
                const { error } = await supabase.from("china_trips").update({ supplier: supplierValue.trim(), name: supplierValue.trim() }).eq("id", trip.id);
                if (error) { toast({ title: "Failed to update", variant: "destructive" }); return; }
                setTrip({ ...trip, supplier: supplierValue.trim(), name: supplierValue.trim() });
                setEditingSupplier(false);
                toast({ title: "Supplier updated" });
              }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingSupplier(false)}>Cancel</Button>
            </div>
          ) : (
            <button
              onClick={() => { setSupplierValue(trip.supplier); setEditingSupplier(true); }}
              className="flex items-center gap-1 group"
              title="Click to edit supplier"
            >
              <h1 className="font-sans text-2xl md:text-3xl font-semibold">{trip.supplier}</h1>
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          <Badge variant="outline">{trip.venue_type === "canton_fair" ? "Canton Fair" : "Factory Visit"}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 group hover:text-foreground transition-colors" title="Click to change date">
                <Calendar className="h-4 w-4" /> {format(new Date(trip.date), "MMMM d, yyyy")}
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarPicker
                mode="single"
                selected={new Date(trip.date + "T00:00:00")}
                onSelect={async (date) => {
                  if (!date) return;
                  const dateStr = format(date, "yyyy-MM-dd");
                  const { error } = await supabase.from("china_trips").update({ date: dateStr }).eq("id", trip.id);
                  if (error) { toast({ title: "Failed to update date", variant: "destructive" }); return; }
                  setTrip({ ...trip, date: dateStr });
                  toast({ title: "Date updated" });
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {trip.location ? (
            <Popover open={showLocationPicker} onOpenChange={setShowLocationPicker}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 group hover:text-foreground transition-colors"
                  title="Click to change location label"
                  onClick={async () => {
                    setShowLocationPicker(true);
                    setLocationEditValue(trip.location || "");
                    // Check if location looks like GPS coordinates
                    const coordMatch = trip.location?.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
                    if (coordMatch) {
                      setResolvingLocation(true);
                      try {
                        const { data } = await supabase.functions.invoke("nearby-stores", {
                          body: { latitude: parseFloat(coordMatch[1]), longitude: parseFloat(coordMatch[2]), radius: 1000 },
                        });
                        if (data?.stores) {
                          setLocationSuggestions(data.stores.map((s: any) => ({ name: s.name, address: s.address })));
                        }
                      } catch {} finally {
                        setResolvingLocation(false);
                      }
                    }
                  }}
                >
                  <MapPin className="h-4 w-4" />{trip.location}
                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="start">
                <div className="space-y-2">
                  <label className="text-xs font-medium">Location Label</label>
                  <Input
                    value={locationEditValue}
                    onChange={(e) => setLocationEditValue(e.target.value)}
                    placeholder="e.g. Canton Fair Complex"
                    className="text-sm"
                  />
                  {resolvingLocation && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Finding nearby locations…
                    </div>
                  )}
                  {locationSuggestions.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Nearby locations:</label>
                      {locationSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setLocationEditValue(s.name)}
                          className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium">{s.name}</span>
                            {s.address && <span className="block text-muted-foreground truncate">{s.address}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={async () => {
                      if (!locationEditValue.trim()) return;
                      const { error } = await supabase.from("china_trips").update({ location: locationEditValue.trim() }).eq("id", trip.id);
                      if (error) { toast({ title: "Failed to update", variant: "destructive" }); return; }
                      setTrip({ ...trip, location: locationEditValue.trim() });
                      setShowLocationPicker(false);
                      setLocationSuggestions([]);
                      toast({ title: "Location updated" });
                    }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowLocationPicker(false); setLocationSuggestions([]); }}>Cancel</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <button
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setLocationEditValue(""); setShowLocationPicker(true); }}
            >
              <MapPin className="h-4 w-4" /> Add location
            </button>
          )}
          <span>{photos.length} photos</span>
          {!online && (
            <Badge variant="outline" className="gap-1">
              <CloudOff className="h-3 w-3" /> Offline
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {uploading ? "Uploading..." : "Add Photos"}
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
          <Images className="h-4 w-4" /> Bulk Upload
        </Button>
        {photos.length > 0 && (
          <>
            <Button variant="outline" onClick={handleDownloadAll} disabled={downloading} className="gap-2">
              <Download className="h-4 w-4" /> {downloading ? "Downloading..." : "Download All"}
            </Button>
            <Button variant="outline" onClick={handleBulkAiDetect} disabled={bulkAnalyzing} className="gap-2">
              <Sparkles className="h-4 w-4" />
              {bulkAnalyzing ? `AI Detecting... ${bulkAnalyzeProgress}%` : "AI Detect All"}
            </Button>
            <Button
              variant={viewAllMode ? "default" : "outline"}
              size="sm"
              onClick={() => setViewAllMode((v) => !v)}
              className="gap-2"
              title={viewAllMode ? "Switch to grouped view" : "View all photos flat"}
            >
              {viewAllMode ? <Layers className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              {viewAllMode ? "Grouped" : "View All"}
            </Button>
          </>
        )}
        {selectedPhotos.size > 0 && (
          <>
            <Button variant="outline" onClick={() => setShowBulkEdit(true)} className="gap-2">
              <PenLine className="h-4 w-4" /> Edit {selectedPhotos.size}
            </Button>
            <Button variant="outline" onClick={() => setShowBulkMove(true)} className="gap-2">
              <ArrowRightLeft className="h-4 w-4" /> Move {selectedPhotos.size}
            </Button>
            {/* Section assignment */}
            {existingSections.length > 0 && (
              <Select onValueChange={(v) => handleAssignSection(v)}>
                <SelectTrigger className="w-auto gap-1 h-9 text-sm">
                  <SelectValue placeholder="Assign section" />
                </SelectTrigger>
                <SelectContent>
                  {existingSections.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelectedPhotos(new Set())}>
              Clear
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowAddSection(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> New Section
        </Button>
        {pendingPhotos.length > 0 && (
          <Badge variant="outline" className="gap-1">
            <CloudOff className="h-3 w-3" /> {pendingPhotos.length} pending
          </Badge>
        )}
      </div>

      {/* Pending uploads */}
      {pendingPhotos.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CloudOff className="h-3 w-3" /> {pendingPhotos.length} pending upload{pendingPhotos.length !== 1 ? "s" : ""} — will sync automatically
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

      {/* Photos grid */}
      {groups.length === 0 && pendingPhotos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Camera className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="font-sans text-xl">No photos yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Add photos from this supplier visit.</p>
          </CardContent>
        </Card>
      ) : viewAllMode ? (
        /* ── Flat "View All" grid ── */
        <div className="grid gap-1 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {photos.map((photo) => (
            <button
              key={photo.id}
              className={cn(
                "relative aspect-square overflow-hidden rounded-md group focus:outline-none focus:ring-2 focus:ring-primary",
                selectedPhotos.has(photo.id) && "ring-2 ring-primary"
              )}
              onClick={(e) => toggleSelectPhoto(photo.id, e)}
            >
              {photo.signed_url ? (
                <img src={photo.signed_url} alt={photo.product_name || "Photo"} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
              ) : (
                <div className="h-full w-full bg-muted animate-pulse" />
              )}
              {photo.product_name && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4">
                  <p className="text-[10px] text-white leading-tight truncate">{photo.product_name}</p>
                </div>
              )}
              {selectedPhotos.has(photo.id) && (
                <div className="absolute inset-0 bg-primary/20" />
              )}
            </button>
          ))}
        </div>
      ) : (
        /* ── Grouped by section (default) ── */
        <div className="space-y-6">
          {sectionedGroups.map(({ section, items }, sIdx) => (
            <div
              key={section ?? "__unsectioned__"}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData("text/plain");
                if (draggedId) {
                  supabase.from("china_photos").update({ section: section ?? null }).eq("id", draggedId)
                    .then(({ error }) => {
                      if (!error) {
                        toast({ title: section ? `Moved to "${section}"` : "Moved to unsectioned" });
                        loadPhotos();
                      }
                    });
                }
              }}
            >
              {section && (
                <div className="mb-3">
                  {sIdx > 0 && <Separator className="mb-4" />}
                  <h3 className="font-sans text-lg font-semibold text-foreground rounded px-2 py-1 -mx-2 transition-colors hover:bg-muted/50">{section}</h3>
                </div>
              )}
              {!section && sIdx > 0 && <Separator className="mb-4" />}
              {items.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center text-sm text-muted-foreground">
                  Drag photos here
                </div>
              ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map(({ primary, extras }) => (
                  <PhotoCard
                    key={primary.id}
                    photo={primary}
                    extraPhotos={extras}
                    tripId={id}
                    onUpdated={loadPhotos}
                    onGroupPhoto={handleGroupPhoto}
                    chinaMode
                    selected={selectedPhotos.has(primary.id)}
                    onSelect={toggleSelectPhoto}
                    selectionMode={selectedPhotos.size > 0}
                    userName={primary.user_id ? userProfiles[primary.user_id] : undefined}
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
            </div>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-sans">Add Photo</DialogTitle>
            {!online && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <CloudOff className="h-3 w-3" /> Offline — photo will sync when connected
              </p>
            )}
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4">
            {previewUrl && (
              <div className="relative">
                <img src={previewUrl} alt="Preview" className="w-full rounded-md object-contain" style={{ maxHeight: "40vh" }} />
                {online && (
                  <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-2 gap-1 text-xs" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {analyzing ? "Detecting..." : "AI Detect"}
                  </Button>
                )}
              </div>
            )}
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
              {uploading ? "Saving..." : online ? "Upload Photo" : "Save Offline"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Section dialog */}
      <Dialog open={showAddSection} onOpenChange={setShowAddSection}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-sans">New Section</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-sm">Section / Booth Name</Label>
            <Input
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="e.g. Booth A23, Factory B"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
            />
            <Button onClick={handleAddSection} className="w-full" disabled={!newSectionName.trim()}>
              {selectedPhotos.size > 0 ? `Create & Assign ${selectedPhotos.size} Photo(s)` : "Create Section"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Geo-fence warning */}
      <AlertDialog open={showGeoWarning} onOpenChange={setShowGeoWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Photo geotagged in the U.S.</AlertDialogTitle>
            <AlertDialogDescription>
              {geoWarningFiles.length === 1
                ? "This photo appears to have been taken in the Americas based on its GPS coordinates. You're uploading to an Asia Trip — did you mean to upload to a Store Shopping trip instead?"
                : `${geoWarningFiles.length} photos appear to have been taken in the Americas. You're uploading to an Asia Trip — did you mean to upload to a Store Shopping trip instead?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleGeoWarningCancel}>Cancel Upload</AlertDialogCancel>
            <AlertDialogAction onClick={handleGeoWarningContinue}>Upload Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {trip && (
        <ChinaMoveToTripDialog
          open={showBulkMove}
          onOpenChange={setShowBulkMove}
          photoIds={Array.from(selectedPhotos)}
          currentTripId={trip.id}
          onMoved={() => { setSelectedPhotos(new Set()); loadPhotos(); }}
        />
      )}

      <BulkEditDialog
        open={showBulkEdit}
        onOpenChange={setShowBulkEdit}
        photoIds={Array.from(selectedPhotos)}
        photos={photos.map((p) => ({ id: p.id, product_name: p.product_name }))}
        onApplied={() => { setSelectedPhotos(new Set()); loadPhotos(); }}
        chinaMode
      />
    </div>
  );
}

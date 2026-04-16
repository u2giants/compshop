import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import { groupPhotos, batchSignedUrls } from "@/lib/photo-utils";
import type { Photo, Trip } from "@/types/models";
import { extractExif, distanceKm } from "@/lib/exif-utils";
import { isInAsia } from "@/lib/geo-utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCategories } from "@/hooks/use-categories";
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
import { useBulkUndo } from "@/hooks/use-bulk-undo";
import { useCountries } from "@/hooks/use-countries";
import { useRetailers } from "@/hooks/use-retailers";
import { Pencil, CalendarIcon } from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import AutocompleteInput from "@/components/ui/autocomplete-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, Calendar, MapPin, Store, Users, CloudOff, Sparkles, Loader2, Download, Images, ArrowRightLeft, PenLine, Trash2, Upload, LayoutGrid, Layers, Undo2 } from "lucide-react";
import { format } from "date-fns";
import PhotoCard from "@/components/trip/PhotoCard";
import TripMembers from "@/components/trip/TripMembers";
import MoveToTripDialog from "@/components/trip/MoveToTripDialog";
import BulkEditDialog from "@/components/trip/BulkEditDialog";
import LinkToCardDialog from "@/components/trip/LinkToCardDialog";

// Photo and Trip types imported from @/types/models
// groupPhotos imported from @/lib/photo-utils

export default function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const countries = useCountries();
  const categories = useCategories();
  const { retailerNames, getLogoUrl } = useRetailers();
  const isMobile = useIsMobile();
  const [editingStore, setEditingStore] = useState(false);
  const [storeValue, setStoreValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { undoAction, undoing, captureSnapshot, setUndo, performUndo, clearUndo } = useBulkUndo();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkSourcePhotoId, setLinkSourcePhotoId] = useState<string | null>(null);
  const lastSelectedPhotoRef = useRef<string | null>(null);
  function getFlatPrimaryIds() { return groupPhotos(photos).map(g => g.primary.id); }
  function toggleSelectPhoto(photoId: string, event?: React.MouseEvent) {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (event?.shiftKey && lastSelectedPhotoRef.current && lastSelectedPhotoRef.current !== photoId) {
        const ids = getFlatPrimaryIds();
        const startIdx = ids.indexOf(lastSelectedPhotoRef.current);
        const endIdx = ids.indexOf(photoId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = from; i <= to; i++) {
            next.add(ids[i]);
          }
          return next;
        }
      }
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
    lastSelectedPhotoRef.current = photoId;
  }
  const formRef = useRef<HTMLFormElement>(null);

  const [trip, setTrip] = useState<Trip | null>(null);
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

  const [lastGroupAction, setLastGroupAction] = useState<{ photoId: string; previousGroupId: string | null } | null>(null);

  function handleMobileLinkRequest(sourcePhotoId: string) {
    setLinkSourcePhotoId(sourcePhotoId);
    setShowLinkDialog(true);
  }

  async function handleGroupPhoto(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const dragged = photos.find((p) => p.id === draggedId);
    if (!dragged) return;
    setLastGroupAction({ photoId: draggedId, previousGroupId: dragged.group_id });

    const { error } = await supabase
      .from("photos")
      .update({ group_id: targetId })
      .eq("id", draggedId);
    if (error) {
      toast({ title: "Grouping failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Photos grouped", description: "Dragged photo merged onto the target card." });
    loadPhotos();
  }

  async function handleUndoGroup() {
    if (!lastGroupAction) return;
    const { error } = await supabase
      .from("photos")
      .update({ group_id: lastGroupAction.previousGroupId })
      .eq("id", lastGroupAction.photoId);
    if (error) {
      toast({ title: "Undo failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ungrouped" });
    setLastGroupAction(null);
    loadPhotos();
  }

  async function handleUnlinkPhoto(photoId: string) {
    const { error } = await supabase
      .from("photos")
      .update({ group_id: null })
      .eq("id", photoId);
    if (error) {
      toast({ title: "Unlink failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Photo unlinked", description: "Photo is now its own card." });
    loadPhotos();
  }

  const [downloading, setDownloading] = useState(false);
  const [viewAllMode, setViewAllMode] = useState(false);

  function buildFileName(photo: Photo, indexInGroup?: number): string {
    const ext = photo.file_path.split(".").pop() || "jpg";
    const dateStr = trip?.date || photo.created_at;
    const d = new Date(dateStr);
    const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const storeName = (trip?.store || "Store").replace(/[^a-zA-Z0-9]/g, "");
    const desc = (photo.product_name || "Photo").replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "");
    const suffix = indexInGroup && indexInGroup > 1 ? `_${indexInGroup}` : "";
    return `${yyyymmdd}_${storeName}_${desc}${suffix}.${ext}`;
  }

  async function handleDownloadAll() {
    if (photos.length === 0) return;
    setDownloading(true);
    let count = 0;

    // Build grouped structure for correct numbering
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
    toast({ title: `Downloaded ${count} photos`, description: "Save them to your camera roll from Downloads." });
  }

  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState(0);

  async function handleBulkAiDetect() {
    const photosWithoutMeta = photos.filter(
      (p) => !p.product_name && !p.brand && !p.price && p.signed_url
    );
    if (photosWithoutMeta.length === 0) {
      toast({ title: "No photos need detection", description: "All photos already have metadata." });
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
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        const { data, error } = await supabase.functions.invoke("analyze-photo", {
          body: { imageBase64: base64, mimeType: blob.type, categories },
        });
        if (error) throw error;

        const updates: Record<string, unknown> = {};
        if (data.product_name) updates.product_name = data.product_name;
        if (data.category) updates.category = data.category;
        if (data.price != null) updates.price = data.price;
        if (data.dimensions) updates.dimensions = data.dimensions;
        if (data.brand) updates.brand = data.brand;
        if (data.material) updates.material = data.material;
        if (data.country_of_origin) updates.country_of_origin = data.country_of_origin;

        if (Object.keys(updates).length > 0) {
          await supabase.from("photos").update(updates).eq("id", photo.id);
          success++;
        }
      } catch (err) {
        console.error("Bulk AI detect failed for:", photo.id, err);
      }
    }

    setBulkAnalyzeProgress(100);
    setBulkAnalyzing(false);
    toast({
      title: "Bulk AI detection complete",
      description: `${success} of ${photosWithoutMeta.length} photos updated with detected metadata.`,
    });
    loadPhotos();
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedPhotos.size} selected photo(s)? This cannot be undone.`)) return;
    let deleted = 0;
    for (const photoId of selectedPhotos) {
      const photo = photos.find(p => p.id === photoId);
      if (!photo) continue;
      try {
        // Delete grouped children first
        const children = photos.filter(p => p.group_id === photoId);
        for (const child of children) {
          await supabase.storage.from("photos").remove([child.file_path]);
          await supabase.from("photos").delete().eq("id", child.id);
        }
        await supabase.storage.from("photos").remove([photo.file_path]);
        const { error } = await supabase.from("photos").delete().eq("id", photoId);
        if (!error) deleted++;
      } catch (err) {
        console.error("Failed to delete photo:", photoId, err);
      }
    }
    toast({ title: `Deleted ${deleted} photo(s)` });
    setSelectedPhotos(new Set());
    loadPhotos();
  }

  const [formFields, setFormFields] = useState({
    product_name: "",
    category: "",
    price: "",
    brand: "",
    dimensions: "",
    material: "",
    notes: "",
  });

  // Auto-join user as trip member if not already
  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data } = await supabase
        .from("trip_members")
        .select("id")
        .eq("trip_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) {
        await supabase.from("trip_members").insert({ trip_id: id, user_id: user.id });
      }
    })();
  }, [id, user]);

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
    const cached = await getCachedTrip(id!);
    if (cached) { setTrip(cached); setLoading(false); }
    if (!navigator.onLine) { setLoading(false); return; }
    try {
      const { data } = await supabase.from("shopping_trips").select("*").eq("id", id!).single();
      if (data) { setTrip(data); await cacheTrips([data as any]); }
    } catch (err) { console.error("[TripDetail] Network error loading trip", err); }
    setLoading(false);
  }

  async function loadPhotos() {
    const cached = await getCachedPhotos(id!);
    if (cached.length > 0) {
      const withUrls = await Promise.all(
        cached.map(async (p) => {
          // Always check blob cache first — signed_url expires after 1 hour
          const blob = await getCachedImageBlob(p.file_path);
          if (blob) return { ...p, signed_url: URL.createObjectURL(blob) };
          return { ...p, signed_url: undefined };
        })
      );
      setPhotos(withUrls as unknown as Photo[]);
    }
    if (!navigator.onLine) return;
    try {
      const { data } = await supabase.from("photos").select("*").eq("trip_id", id!).order("created_at", { ascending: false });
      if (data) {
        // Batch signed URL generation (single API call instead of N)
        const urlMap = await batchSignedUrls(data);
        const withUrls = data.map((p) => {
          const signed_url = urlMap.get(p.file_path);
          if (signed_url) cacheImageInBackground(p.file_path, signed_url);
          return { ...p, signed_url };
        });
        setPhotos(withUrls);
        // Strip signed_url before caching — they expire and shouldn't be persisted
        const toCache = data.map(({ ...p }) => ({ ...p, signed_url: undefined }));
        await cachePhotos(toCache as unknown as CachedPhoto[]);
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
    } catch (err) { console.error("[TripDetail] Network error loading photos", err); }
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

  // GPS interpolation state
  const [gpsInterpolationCandidates, setGpsInterpolationCandidates] = useState<
    { photoId: string; latitude: number; longitude: number }[]
  >([]);
  const [showGpsConfirm, setShowGpsConfirm] = useState(false);

  /**
   * After upload, scan trip photos by created_at order.
   * If a photo lacks GPS but its immediate neighbors both have GPS
   * within 150m of each other, inherit that location.
   */
  async function runGpsInterpolation() {
    if (!id) return;
    const { data: allPhotos } = await supabase
      .from("photos")
      .select("id, latitude, longitude, created_at")
      .eq("trip_id", id)
      .order("created_at", { ascending: true });
    if (!allPhotos || allPhotos.length < 3) return;

    const candidates: { photoId: string; latitude: number; longitude: number }[] = [];
    for (let i = 1; i < allPhotos.length - 1; i++) {
      const curr = allPhotos[i];
      if (curr.latitude != null && curr.longitude != null) continue; // already has GPS
      const prev = allPhotos[i - 1];
      const next = allPhotos[i + 1];
      if (
        prev.latitude != null && prev.longitude != null &&
        next.latitude != null && next.longitude != null
      ) {
        const dist = distanceKm(prev.latitude, prev.longitude, next.latitude, next.longitude);
        if (dist <= 0.15) {
          // Neighbors are within 150m — use average
          candidates.push({
            photoId: curr.id,
            latitude: (prev.latitude + next.latitude) / 2,
            longitude: (prev.longitude + next.longitude) / 2,
          });
        }
      }
    }
    if (candidates.length > 0) {
      setGpsInterpolationCandidates(candidates);
      setShowGpsConfirm(true);
    }
  }

  async function applyGpsInterpolation() {
    for (const c of gpsInterpolationCandidates) {
      await supabase
        .from("photos")
        .update({ latitude: c.latitude, longitude: c.longitude })
        .eq("id", c.photoId);
    }
    toast({
      title: `GPS applied to ${gpsInterpolationCandidates.length} photo(s)`,
      description: "Coordinates inherited from neighboring photos.",
    });
    setShowGpsConfirm(false);
    setGpsInterpolationCandidates([]);
  }

  function dismissGpsInterpolation() {
    setShowGpsConfirm(false);
    setGpsInterpolationCandidates([]);
  }

  async function checkGeoFence(files: File[]): Promise<{ ok: File[]; warned: File[] }> {
    const ok: File[] = [];
    const warned: File[] = [];
    for (const file of files) {
      const exif = await extractExif(file);
      if (exif.latitude != null && exif.longitude != null && isInAsia(exif.latitude, exif.longitude)) {
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
      // Single file — check geo then open detail dialog
      const file = files[0];
      extractExif(file).then((exif) => {
        if (exif.latitude != null && exif.longitude != null && isInAsia(exif.latitude, exif.longitude)) {
          setGeoWarningFiles([file]);
          setGeoWarningType("single");
          setShowGeoWarning(true);
        } else {
          openSingleUpload(file);
        }
      });
    } else {
      // Multiple files — check geo for all
      const fileArray = Array.from(files);
      checkGeoFence(fileArray).then(({ ok, warned }) => {
        if (warned.length > 0 && ok.length === 0) {
          setGeoWarningFiles(warned);
          setGeoWarningType("bulk");
          setShowGeoWarning(true);
        } else if (warned.length > 0) {
          // Some warned, some ok — upload ok ones, warn about rest
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
    toast({ title: "Upload cancelled", description: "Photos with Asia GPS coordinates were not uploaded." });
  }

  async function handleBulkUpload(files: File[]) {
    if (!user || !id) return;
    setUploading(true);
    let successCount = 0;
    let failCount = 0;
    let dupCount = 0;
    let pendingCount = 0;

    for (const file of files) {
      try {
        const fileHash = await hashFile(file);
        if (await checkDuplicatePhoto(fileHash)) {
          dupCount++;
          continue;
        }
        const exif = await extractExif(file);
        const lat = exif.latitude ?? null;
        const lng = exif.longitude ?? null;

        const { filePath, thumbnailPath } = await uploadPhoto(file, user.id, id);
        const { error } = await supabase.from("photos").insert({
          trip_id: id, user_id: user.id, file_path: filePath, thumbnail_path: thumbnailPath, file_hash: fileHash,
          ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
        });
        if (error) throw error;
        successCount++;
      } catch {
        // Queue for background sync on any failure (network, timeout, etc.)
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
    if (dupCount > 0) parts.push(`${dupCount} duplicate${dupCount > 1 ? "s" : ""} skipped`);
    if (pendingCount > 0) parts.push(`${pendingCount} queued for sync`);
    if (failCount > 0) parts.push(`${failCount} failed`);
    toast({
      title: `Bulk upload complete`,
      description: `${parts.join(", ")}. You can add details to each photo individually.`,
    });
    loadPhotos();
    loadPendingPhotos();
    // Trigger sync immediately for any queued items
    if (pendingCount > 0) runSync();
    // Check for GPS interpolation after upload
    runGpsInterpolation();
  }

  async function handleFileDropOnCard(files: File[], targetPhotoId: string) {
    if (!user || !id) return;
    setUploading(true);
    let successCount = 0;

    for (const file of files) {
      try {
        const fileHash = await hashFile(file);
        if (await checkDuplicatePhoto(fileHash)) continue;
        const { filePath, thumbnailPath } = await uploadPhoto(file, user.id, id);
        const { error } = await supabase.from("photos").insert({
          trip_id: id, user_id: user.id, file_path: filePath, thumbnail_path: thumbnailPath, group_id: targetPhotoId, file_hash: fileHash,
        });
        if (error) throw error;
        successCount++;
      } catch {
        const pendingId = crypto.randomUUID();
        await addPendingUpload({
          id: pendingId, trip_id: id, file_blob: file, file_name: file.name,
          metadata: { product_name: null, category: null, price: null, dimensions: null, country_of_origin: null, material: null, brand: null, notes: null },
          user_id: user.id, created_at: new Date().toISOString(), status: "pending", retry_count: 0,
        });
      }
    }

    setUploading(false);
    toast({
      title: `${successCount} photo${successCount !== 1 ? "s" : ""} added to card`,
    });
    loadPhotos();
    loadPendingPhotos();
  }

  async function handleAnalyze() {
    if (!selectedFile) return;
    setAnalyzing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const { data, error } = await supabase.functions.invoke("analyze-photo", {
        body: { imageBase64: base64, mimeType: selectedFile.type, categories },
      });

      if (error) throw error;

      // Pre-fill the fields
      if (data.product_name) setFormFields((f) => ({ ...f, product_name: data.product_name }));
      if (data.category) setFormFields((f) => ({ ...f, category: data.category }));
      if (data.price != null) setFormFields((f) => ({ ...f, price: String(data.price) }));
      if (data.dimensions) setFormFields((f) => ({ ...f, dimensions: data.dimensions }));
      if (data.brand) setFormFields((f) => ({ ...f, brand: data.brand }));
      if (data.material) setFormFields((f) => ({ ...f, material: data.material }));
      if (data.country_of_origin) setCountryValue(data.country_of_origin);

      toast({ title: "AI analysis complete", description: "Fields have been pre-filled." });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedFile || !user || !id) return;
    setUploading(true);

    const metadata = {
      product_name: formFields.product_name || null,
      category: formFields.category || null,
      price: formFields.price ? Number(formFields.price) : null,
      dimensions: formFields.dimensions || null,
      country_of_origin: countryValue || null,
      material: formFields.material || null,
      brand: formFields.brand || null,
      notes: formFields.notes || null,
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
        toast({ title: "Duplicate detected", description: "This photo has already been uploaded.", variant: "destructive" });
        setUploading(false);
        return;
      }
      const exif = await extractExif(selectedFile);
      const lat = exif.latitude ?? null;
      const lng = exif.longitude ?? null;

      const { filePath, thumbnailPath } = await uploadPhoto(selectedFile, user.id, id);
      const { error } = await supabase.from("photos").insert({
        trip_id: id, user_id: user.id, file_path: filePath, thumbnail_path: thumbnailPath, file_hash: fileHash, ...metadata,
        ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
      });
      if (error) throw error;
      toast({ title: "Photo uploaded!" });
      setShowUploadDialog(false); setSelectedFile(null); setPreviewUrl(null);
      loadPhotos();
      // Run GPS interpolation after upload
      runGpsInterpolation();
    } catch (err: any) {
      const pendingId = crypto.randomUUID();
      await addPendingUpload({
        id: pendingId, trip_id: id, file_blob: selectedFile, file_name: selectedFile.name,
        metadata, user_id: user.id, created_at: new Date().toISOString(), status: "pending", retry_count: 0,
      });
      toast({ title: "Saved for later sync", description: "Upload failed, but your photo is saved locally." });
      setShowUploadDialog(false); setSelectedFile(null); setPreviewUrl(null);
      loadPendingPhotos();
    } finally {
      setUploading(false);
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (files.length === 0) return;
    if (files.length === 1) {
      openSingleUpload(files[0]);
    } else {
      handleBulkUpload(files);
    }
  }, [user, id]);

  if (loading) return <div className="container py-6"><div className="h-8 w-48 animate-pulse rounded bg-muted" /></div>;
  if (!trip) return <div className="container py-6">Trip not found</div>;

  return (
    <div
      className="container py-6 relative"
      {...(!isMobile ? {
        onDragOver: handleDragOver,
        onDragEnter: handleDragEnter,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
      } : {})}
    >
      {/* Desktop drag overlay */}
      {dragOver && !isMobile && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-primary bg-card/90 px-12 py-10 text-center shadow-lg">
            <Upload className="mx-auto mb-3 h-10 w-10 text-primary" />
            <p className="text-lg font-semibold text-primary">Drop photos here</p>
            <p className="mt-1 text-sm text-muted-foreground">Files will be uploaded to this trip</p>
          </div>
        </div>
      )}
      <button onClick={() => navigate("/")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All Trips
      </button>

      <div className="mb-6">
        <h1 className="font-sans text-2xl md:text-3xl font-semibold">{trip.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {editingStore ? (
            <div className="flex items-center gap-2 max-w-xs">
              <AutocompleteInput
                value={storeValue}
                onChange={setStoreValue}
                suggestions={retailerNames}
                placeholder="Store name"
                className="text-sm"
                renderSuggestion={(name) => {
                  const logo = getLogoUrl(name);
                  return (
                    <span className="flex items-center gap-2">
                      {logo && <img src={logo} alt="" className="h-4 w-4 object-contain" />}
                      {name}
                    </span>
                  );
                }}
              />
              <Button size="sm" onClick={async () => {
                if (!storeValue.trim()) return;
                const { error } = await supabase.from("shopping_trips").update({ store: storeValue.trim(), name: storeValue.trim() }).eq("id", trip.id);
                if (error) { toast({ title: "Failed to update store", variant: "destructive" }); return; }
                setTrip({ ...trip, store: storeValue.trim(), name: storeValue.trim() });
                setEditingStore(false);
                toast({ title: "Store updated" });
              }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingStore(false)}>Cancel</Button>
            </div>
          ) : (
            <button
              onClick={() => { setStoreValue(trip.store); setEditingStore(true); }}
              className="flex items-center gap-1 group"
              title="Click to edit store name"
            >
              {(() => {
                const logoUrl = getLogoUrl(trip.store);
                return logoUrl ? (
                  <img src={logoUrl} alt={trip.store} className="h-6 object-contain" title={trip.store} />
                ) : (
                  <span className="flex items-center gap-1 font-sans text-base"><Store className="h-3.5 w-3.5" /> {trip.store}</span>
                );
              })()}
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 group hover:text-foreground transition-colors" title="Click to change date">
                <Calendar className="h-3.5 w-3.5" /> {format(new Date(trip.date), "MMM d, yyyy")}
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
                  const { error } = await supabase.from("shopping_trips").update({ date: dateStr }).eq("id", trip.id);
                  if (error) { toast({ title: "Failed to update date", variant: "destructive" }); return; }
                  setTrip({ ...trip, date: dateStr });
                  toast({ title: "Date updated" });
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {trip.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {trip.location}</span>}
        </div>
        {trip.notes && <p className="mt-2 text-sm text-muted-foreground">{trip.notes}</p>}
      </div>

      <TripMembers tripId={trip.id} createdBy={trip.created_by} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
        {isMobile && (
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
        )}
        {isMobile ? (
          <>
            <Button onClick={() => cameraInputRef.current?.click()} className="gap-2">
              <Camera className="h-4 w-4" /> Take Photo
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Images className="h-4 w-4" /> Upload
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Camera className="h-4 w-4" /> Add Photo
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Images className="h-4 w-4" /> Bulk Upload
            </Button>
          </>
        )}
        {photos.length > 0 && (
          <>
            <Button variant="outline" onClick={handleDownloadAll} disabled={downloading} className="gap-2">
              <Download className="h-4 w-4" /> {downloading ? "Downloading..." : "Download All"}
            </Button>
            <Button
              variant="outline"
              onClick={handleBulkAiDetect}
              disabled={bulkAnalyzing}
              className="gap-2"
            >
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
              <PenLine className="h-4 w-4" /> Edit {selectedPhotos.size} Selected
            </Button>
            <Button variant="outline" onClick={() => setShowBulkMove(true)} className="gap-2">
              <ArrowRightLeft className="h-4 w-4" /> Move {selectedPhotos.size} Selected
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} className="gap-2">
              <Trash2 className="h-4 w-4" /> Delete {selectedPhotos.size} Selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedPhotos(new Set())}>
              Clear Selection
            </Button>
          </>
        )}
        <Badge variant="secondary">{photos.length} photos</Badge>
        {pendingPhotos.length > 0 && (
          <Badge variant="outline" className="gap-1">
            <CloudOff className="h-3 w-3" /> {pendingPhotos.length} pending
          </Badge>
        )}
        {lastGroupAction && (
          <Button variant="outline" size="sm" onClick={handleUndoGroup} className="gap-1 text-xs">
            Undo group
          </Button>
        )}
        {undoAction && (
          <Button variant="outline" size="sm" onClick={() => performUndo(loadPhotos)} disabled={undoing} className="gap-1 text-xs">
            <Undo2 className="h-3.5 w-3.5" /> {undoing ? "Undoing..." : `Undo ${undoAction.label}`}
          </Button>
        )}
      </div>

      {/* Upload dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-sans">Add Photo Details</DialogTitle>
            {!online && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <CloudOff className="h-3 w-3" /> Offline — photo will sync when connected
              </p>
            )}
          </DialogHeader>
          <form ref={formRef} onSubmit={handleUpload} className="space-y-4">
            {previewUrl && (
              <div className="relative">
                <img src={previewUrl} alt="Preview" className="max-h-48 w-full rounded-lg object-cover" />
                {online && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-2 right-2 gap-1 text-xs"
                    onClick={handleAnalyze}
                    disabled={analyzing}
                  >
                    {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {analyzing ? "Analyzing..." : "AI Detect"}
                  </Button>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Product Name</Label>
                <Input value={formFields.product_name} onChange={(e) => setFormFields((f) => ({ ...f, product_name: e.target.value }))} placeholder="e.g. Ceramic Table Lamp" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formFields.category} onValueChange={(v) => setFormFields((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input type="number" step="0.01" value={formFields.price} onChange={(e) => setFormFields((f) => ({ ...f, price: e.target.value }))} placeholder="$0.00" />
              </div>
              <div className="space-y-2">
                <Label>Brand</Label>
                <Input value={formFields.brand} onChange={(e) => setFormFields((f) => ({ ...f, brand: e.target.value }))} placeholder="Brand name" />
              </div>
              <div className="space-y-2">
                <Label>Size/Dimensions</Label>
                <Input value={formFields.dimensions} onChange={(e) => setFormFields((f) => ({ ...f, dimensions: e.target.value }))} placeholder='e.g. 12"x8"' />
              </div>
              <div className="space-y-2">
                <Label>Made In</Label>
                <AutocompleteInput
                  value={countryValue}
                  onChange={setCountryValue}
                  suggestions={countries}
                  placeholder="Country"
                />
              </div>
              <div className="space-y-2">
                <Label>Material</Label>
                <Input value={formFields.material} onChange={(e) => setFormFields((f) => ({ ...f, material: e.target.value }))} placeholder="e.g. Ceramic, Wood" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Notes</Label>
                <Textarea value={formFields.notes} onChange={(e) => setFormFields((f) => ({ ...f, notes: e.target.value }))} placeholder="Additional observations..." rows={2} />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={uploading}>
              {uploading ? "Saving..." : online ? "Save Photo" : "Save Offline"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Geo-fence warning */}
      <AlertDialog open={showGeoWarning} onOpenChange={setShowGeoWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Photo geotagged in Asia</AlertDialogTitle>
            <AlertDialogDescription>
              {geoWarningFiles.length === 1
                ? "This photo appears to have been taken in Asia based on its GPS coordinates. You're uploading to a Store Shopping trip — did you mean to upload to an Asia Trip instead?"
                : `${geoWarningFiles.length} photos appear to have been taken in Asia. You're uploading to a Store Shopping trip — did you mean to upload to an Asia Trip instead?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleGeoWarningCancel}>Cancel Upload</AlertDialogCancel>
            <AlertDialogAction onClick={handleGeoWarningContinue}>Upload Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* GPS interpolation confirmation */}
      <AlertDialog open={showGpsConfirm} onOpenChange={setShowGpsConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply GPS from nearby photos?</AlertDialogTitle>
            <AlertDialogDescription>
              {gpsInterpolationCandidates.length} photo{gpsInterpolationCandidates.length !== 1 ? "s" : ""} had no GPS data, but the photos taken before and after were at the same location. Apply those coordinates?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={dismissGpsInterpolation}>No thanks</AlertDialogCancel>
            <AlertDialogAction onClick={applyGpsInterpolation}>Apply GPS</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pendingPhotos.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CloudOff className="h-3 w-3" /> {pendingPhotos.length} pending upload{pendingPhotos.length !== 1 ? "s" : ""} — will sync automatically
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
        /* ── Grouped view (default) ── */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groupPhotos(photos).map(({ primary, extras }) => (
            <PhotoCard
              key={primary.id}
              photo={primary}
              extraPhotos={extras}
              tripId={trip.id}
              onUpdated={loadPhotos}
              onGroupPhoto={handleGroupPhoto}
              onFileDrop={handleFileDropOnCard}
              onMobileLinkRequest={handleMobileLinkRequest}
              onUnlinkPhoto={handleUnlinkPhoto}
              selected={selectedPhotos.has(primary.id)}
              onSelect={toggleSelectPhoto}
              selectionMode={selectedPhotos.size > 0}
              userName={primary.user_id ? userProfiles[primary.user_id] : undefined}
            />
          ))}
        </div>
      )}

      <MoveToTripDialog
        open={showBulkMove}
        onOpenChange={setShowBulkMove}
        photoIds={Array.from(selectedPhotos)}
        currentTripId={trip.id}
        onMoved={() => {
          const ids = Array.from(selectedPhotos);
          const snapshots = captureSnapshot(ids, photos as any[], ["trip_id"]);
          setUndo({ type: "move", label: `move (${ids.length} photos)`, snapshots, table: "photos" });
          setSelectedPhotos(new Set());
          loadPhotos();
        }}
      />

      <BulkEditDialog
        open={showBulkEdit}
        onOpenChange={setShowBulkEdit}
        photoIds={Array.from(selectedPhotos)}
        photos={photos.map((p) => ({ id: p.id, product_name: p.product_name }))}
        onApplied={() => {
          const ids = Array.from(selectedPhotos);
          const snapshots = captureSnapshot(ids, photos as any[], [
            "product_name", "category", "price", "brand", "dimensions", "country_of_origin", "material", "image_type",
          ]);
          setUndo({ type: "edit", label: `bulk edit (${ids.length} photos)`, snapshots, table: "photos" });
          setSelectedPhotos(new Set());
          loadPhotos();
        }}
      />

      {linkSourcePhotoId && (
        <LinkToCardDialog
          open={showLinkDialog}
          onOpenChange={(open) => { setShowLinkDialog(open); if (!open) setLinkSourcePhotoId(null); }}
          sourcePhotoId={linkSourcePhotoId}
          photos={groupPhotos(photos).map(g => ({
            id: g.primary.id,
            product_name: g.primary.product_name,
            signed_url: g.primary.signed_url,
          }))}
          onLink={handleGroupPhoto}
        />
      )}
    </div>
  );
}

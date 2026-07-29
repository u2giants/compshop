import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CloudUpload, Database, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getLocalRecoverySnapshot,
  type LocalRecoverySnapshot,
} from "@/lib/offline-db";
import { pendingUploadMetadata, safeRecoveryExtension } from "@/lib/local-recovery";

type BackupState = "idle" | "loading" | "uploading" | "complete" | "failed";

export default function LocalRecovery() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<LocalRecoverySnapshot | null>(null);
  const [state, setState] = useState<BackupState>("loading");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Reading protected local storage...");
  const [backupPath, setBackupPath] = useState("");

  useEffect(() => {
    getLocalRecoverySnapshot()
      .then((data) => {
        setSnapshot(data);
        setState("idle");
        setStatus("Local data is ready to back up.");
      })
      .catch((error) => {
        console.error("[Recovery] Could not read local data", error);
        setState("failed");
        setStatus("Could not read local data. Keep the app open and do not clear it.");
      });
  }, []);

  const counts = useMemo(() => {
    if (!snapshot) return null;
    return {
      trips: snapshot.trips.length,
      chinaTrips: snapshot.chinaTrips.length,
      photos: snapshot.photos.length,
      chinaPhotos: snapshot.chinaPhotos.length,
      pendingTrips: snapshot.pendingTrips.length + snapshot.pendingChinaTrips.length,
      pendingUploads: snapshot.pendingUploads.length,
      localBlobs: snapshot.imageBlobs.length,
    };
  }, [snapshot]);

  async function upload(path: string, body: Blob, contentType: string) {
    const { error } = await supabase.storage.from("photos").upload(path, body, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
  }

  async function createBackup() {
    if (!snapshot || !user || state === "uploading") return;
    setState("uploading");
    setProgress(0);

    const backupId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
    const root = `${user.id}/recovery-backups/${backupId}`;
    const totalBlobs = snapshot.pendingUploads.length + snapshot.imageBlobs.length;
    let completedBlobs = 0;

    try {
      setStatus("Creating recovery manifest...");
      const manifest = {
        format: "compshop-local-recovery-v1",
        created_at: new Date().toISOString(),
        current_user_id: user.id,
        current_user_email: user.email,
        backup_root: root,
        trips: snapshot.trips,
        china_trips: snapshot.chinaTrips,
        photos: snapshot.photos,
        china_photos: snapshot.chinaPhotos,
        pending_trips: snapshot.pendingTrips,
        pending_china_trips: snapshot.pendingChinaTrips,
        pending_uploads: snapshot.pendingUploads.map(pendingUploadMetadata),
        image_blobs: snapshot.imageBlobs.map((item, index) => ({
          file_path: item.file_path,
          cached_at: item.cached_at,
          size: item.blob.size,
          type: item.blob.type,
          backup_object: `${root}/image-blobs/${String(index).padStart(6, "0")}${safeRecoveryExtension(item.file_path, item.blob.type)}`,
        })),
        counts,
      };

      await upload(
        `${root}/manifest-started.json`,
        new Blob([JSON.stringify(manifest)], { type: "application/json" }),
        "application/json",
      );

      for (let index = 0; index < snapshot.pendingUploads.length; index += 1) {
        const item = snapshot.pendingUploads[index];
        setStatus(`Backing up unsent photo ${index + 1} of ${snapshot.pendingUploads.length}...`);
        await upload(
          `${root}/pending-uploads/${item.id}${safeRecoveryExtension(item.file_name, item.file_blob.type)}`,
          item.file_blob,
          item.file_blob.type || "application/octet-stream",
        );
        completedBlobs += 1;
        setProgress(totalBlobs === 0 ? 90 : Math.round((completedBlobs / totalBlobs) * 90));
      }

      for (let index = 0; index < snapshot.imageBlobs.length; index += 1) {
        const item = snapshot.imageBlobs[index];
        setStatus(`Backing up cached photo ${index + 1} of ${snapshot.imageBlobs.length}...`);
        await upload(
          `${root}/image-blobs/${String(index).padStart(6, "0")}${safeRecoveryExtension(item.file_path, item.blob.type)}`,
          item.blob,
          item.blob.type || "application/octet-stream",
        );
        completedBlobs += 1;
        setProgress(totalBlobs === 0 ? 90 : Math.round((completedBlobs / totalBlobs) * 90));
      }

      setStatus("Sealing recovery backup...");
      await upload(
        `${root}/manifest.json`,
        new Blob([JSON.stringify({ ...manifest, completed_at: new Date().toISOString() })], {
          type: "application/json",
        }),
        "application/json",
      );

      setBackupPath(root);
      setProgress(100);
      setState("complete");
      setStatus("Backup complete. Keep this screen open.");
    } catch (error) {
      console.error("[Recovery] Backup failed", error);
      setState("failed");
      setStatus(`Backup stopped: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return (
    <div className="container max-w-2xl space-y-6 py-6">
      <Button variant="ghost" className="gap-2" onClick={() => navigate("/profile")}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      <div>
        <h1 className="font-sans text-3xl font-semibold">Local Data Recovery</h1>
        <p className="mt-2 text-muted-foreground">
          This screen copies the cards and photos stored on this device. It does not delete or change them.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" /> Data found on this device
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {counts ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>Shopping cards: <strong>{counts.trips}</strong></div>
              <div>Asia cards: <strong>{counts.chinaTrips}</strong></div>
              <div>Photo records: <strong>{counts.photos + counts.chinaPhotos}</strong></div>
              <div>Unsent cards: <strong>{counts.pendingTrips}</strong></div>
              <div>Unsent photos: <strong>{counts.pendingUploads}</strong></div>
              <div>Local photo files: <strong>{counts.localBlobs}</strong></div>
            </div>
          ) : (
            <p>Reading local data...</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Protected backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{status}</p>
          {(state === "uploading" || state === "complete") && <Progress value={progress} />}
          {backupPath && <p className="break-all text-xs text-muted-foreground">Backup: {backupPath}</p>}
          <Button
            className="w-full gap-2"
            onClick={createBackup}
            disabled={!snapshot || state === "uploading" || state === "complete"}
          >
            <CloudUpload className="h-4 w-4" />
            {state === "complete" ? "Backup Complete" : "Back Up This Device"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Keep the app open until the progress reaches 100%.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BulkUndoAction {
  type: "edit" | "move" | "section";
  label: string;
  /** Photo snapshots to restore: id + all fields that were potentially changed */
  snapshots: Record<string, unknown>[];
  table: "photos" | "china_photos";
}

/**
 * Hook to manage undo for bulk photo actions (edit, move, section assignment).
 * Stores one undoable action at a time; auto-expires after 30 seconds.
 */
export function useBulkUndo() {
  const [undoAction, setUndoAction] = useState<BulkUndoAction | null>(null);
  const [undoing, setUndoing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const captureSnapshot = useCallback(
    (
      photoIds: string[],
      photos: { id: string; [key: string]: unknown }[],
      fields: string[]
    ): Record<string, unknown>[] => {
      return photoIds
        .map((id) => {
          const photo = photos.find((p) => p.id === id);
          if (!photo) return null;
          const snap: Record<string, unknown> = { id };
          for (const field of fields) {
            snap[field] = photo[field] ?? null;
          }
          return snap;
        })
        .filter(Boolean) as Record<string, unknown>[];
    },
    []
  );

  const setUndo = useCallback(
    (action: BulkUndoAction) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setUndoAction(action);
      timerRef.current = setTimeout(() => setUndoAction(null), 30000);
    },
    []
  );

  const performUndo = useCallback(
    async (onDone: () => void) => {
      if (!undoAction) return;
      setUndoing(true);
      try {
        for (const snap of undoAction.snapshots) {
          const id = String(snap.id);
          const updates = { ...snap };
          delete updates.id;
          await supabase.from(undoAction.table).update(updates).eq("id", id);
        }
        onDone();
      } catch (err) {
        console.error("Undo failed:", err);
      } finally {
        setUndoing(false);
        setUndoAction(null);
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    },
    [undoAction]
  );

  const clearUndo = useCallback(() => {
    setUndoAction(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { undoAction, undoing, captureSnapshot, setUndo, performUndo, clearUndo };
}

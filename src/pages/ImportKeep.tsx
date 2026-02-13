import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface ParsedKeepCard {
  title: string;
  content: string;
  images: { name: string; blob: Blob }[];
  createdDate?: string;
}

interface ImportResult {
  cardTitle: string;
  status: "success" | "error";
  message: string;
}

export default function ImportKeep() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsedCards, setParsedCards] = useState<ParsedKeepCard[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [phase, setPhase] = useState<"select" | "preview" | "importing" | "done">("select");

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const cards: ParsedKeepCard[] = [];
    const imageFiles = new Map<string, File>();

    // Separate HTML files and image files
    for (const file of Array.from(files)) {
      if (file.name.endsWith(".html")) {
        // Parse HTML
        const text = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");

        const title = doc.querySelector(".title")?.textContent?.trim()
          || doc.querySelector("title")?.textContent?.trim()
          || file.name.replace(".html", "");

        const contentEl = doc.querySelector(".content");
        const content = contentEl?.textContent?.trim() || "";

        // Find image references
        const imgElements = doc.querySelectorAll("img");
        const imageNames: string[] = [];
        imgElements.forEach((img) => {
          const src = img.getAttribute("src");
          if (src) imageNames.push(src);
        });

        cards.push({ title, content, images: [], createdDate: undefined });

        // Try to find date from annotations or heading
        const dateEl = doc.querySelector(".heading");
        if (dateEl?.textContent) {
          cards[cards.length - 1].createdDate = dateEl.textContent.trim();
        }

        // Store image names for later matching
        (cards[cards.length - 1] as any)._imageNames = imageNames;
      } else if (file.type.startsWith("image/")) {
        imageFiles.set(file.name, file);
      }
    }

    // Match images to cards
    for (const card of cards) {
      const imageNames = (card as any)._imageNames as string[] || [];
      for (const imgName of imageNames) {
        const baseName = imgName.split("/").pop() || imgName;
        const imageFile = imageFiles.get(baseName);
        if (imageFile) {
          card.images.push({ name: baseName, blob: imageFile });
        }
      }
      delete (card as any)._imageNames;
    }

    // If no HTML found, treat all images as a single import card
    if (cards.length === 0 && imageFiles.size > 0) {
      const images = Array.from(imageFiles.entries()).map(([name, file]) => ({
        name,
        blob: file,
      }));
      cards.push({ title: "Keep Import", content: "", images });
    }

    setParsedCards(cards);
    setPhase("preview");
  }

  async function handleImport() {
    if (!user) return;
    setImporting(true);
    setPhase("importing");
    const importResults: ImportResult[] = [];

    for (let i = 0; i < parsedCards.length; i++) {
      const card = parsedCards[i];
      setProgress(Math.round(((i) / parsedCards.length) * 100));

      try {
        // Create a trip for each Keep card
        const { data: trip, error: tripErr } = await supabase
          .from("shopping_trips")
          .insert({
            name: card.title || "Keep Import",
            store: "Google Keep Import",
            notes: card.content || null,
            created_by: user.id,
          })
          .select()
          .single();

        if (tripErr || !trip) throw tripErr || new Error("Failed to create trip");

        // Add user as trip member
        await supabase.from("trip_members").insert({ trip_id: trip.id, user_id: user.id });

        // Upload images as photos
        for (const img of card.images) {
          try {
            const file = new File([img.blob], img.name, { type: img.blob.type || "image/jpeg" });
            const fileHash = await hashFile(file);
            if (await checkDuplicatePhoto(fileHash)) continue;
            const filePath = await uploadPhoto(file, user.id, trip.id);
            await supabase.from("photos").insert({
              trip_id: trip.id,
              user_id: user.id,
              file_path: filePath,
              file_hash: fileHash,
              notes: `Imported from Google Keep: ${card.title}`,
            });
          } catch (imgErr) {
            console.error("Failed to upload image:", img.name, imgErr);
          }
        }

        importResults.push({ cardTitle: card.title, status: "success", message: `${card.images.length} photos imported` });
      } catch (err: any) {
        importResults.push({ cardTitle: card.title, status: "error", message: err.message });
      }
    }

    setProgress(100);
    setResults(importResults);
    setPhase("done");
    setImporting(false);

    const successCount = importResults.filter((r) => r.status === "success").length;
    toast({
      title: "Import complete",
      description: `${successCount} of ${parsedCards.length} cards imported successfully.`,
    });
  }

  return (
    <div className="container max-w-2xl py-6">
      <button onClick={() => navigate("/profile")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Profile
      </button>

      <h1 className="mb-6 font-sans text-2xl font-semibold">Import from Google Keep</h1>

      {phase === "select" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-sans">How to export from Google Keep</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Go to <a href="https://takeout.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">takeout.google.com</a></li>
              <li>Click "Deselect all", then scroll down and select only <strong>Keep</strong></li>
              <li>Click "Next step" → "Create export"</li>
              <li>Download and unzip the export file</li>
              <li>Select the HTML and image files from the <code>Keep/</code> folder below</li>
            </ol>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".html,image/*"
              className="hidden"
              onChange={handleFilesSelected}
            />
            <Button onClick={() => fileInputRef.current?.click()} className="w-full gap-2">
              <Upload className="h-4 w-4" /> Select Keep Export Files
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "preview" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Found {parsedCards.length} card{parsedCards.length !== 1 ? "s" : ""} to import.
            Each card will become a shopping trip.
          </p>

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {parsedCards.map((card, i) => (
              <Card key={i}>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{card.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {card.images.length} image{card.images.length !== 1 ? "s" : ""}
                        {card.content ? ` • ${card.content.slice(0, 60)}...` : ""}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setParsedCards([]); setPhase("select"); }}>
              Back
            </Button>
            <Button onClick={handleImport} className="flex-1 gap-2">
              <Upload className="h-4 w-4" /> Import {parsedCards.length} Cards
            </Button>
          </div>
        </div>
      )}

      {phase === "importing" && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Importing cards...</p>
            <Progress value={progress} />
          </CardContent>
        </Card>
      )}

      {phase === "done" && (
        <div className="space-y-4">
          <div className="space-y-2">
            {results.map((r, i) => (
              <Card key={i}>
                <CardContent className="flex items-center gap-3 p-3">
                  {r.status === "success" ? (
                    <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{r.cardTitle}</p>
                    <p className="text-xs text-muted-foreground">{r.message}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setParsedCards([]); setResults([]); setPhase("select"); }}>
              Import More
            </Button>
            <Button onClick={() => navigate("/")} className="flex-1">
              View Trips
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

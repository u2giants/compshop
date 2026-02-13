import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto } from "@/lib/supabase-helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Loader2, CheckCircle, MessageSquare, X, ImagePlus } from "lucide-react";

interface ParsedConversation {
  store: string;
  date: string;
  notes: string;
}

export default function ImportTeams() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [conversationText, setConversationText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedConversation | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [store, setStore] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setImages((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) {
      setImages((prev) => [...prev, ...files]);
    }
  }, []);

  async function handleParse() {
    if (!conversationText.trim()) {
      toast({ title: "Paste the conversation first", variant: "destructive" });
      return;
    }
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-teams-conversation", {
        body: { text: conversationText },
      });
      if (error) throw error;

      const result: ParsedConversation = {
        store: data.store || "Unknown Store",
        date: data.date || new Date().toISOString().split("T")[0],
        notes: data.notes || "",
      };
      setParsed(result);
      setStore(result.store);
      setDate(result.date);
      setNotes(result.notes);
      toast({ title: "Parsed!", description: `Store: ${result.store}, Date: ${result.date}` });
    } catch (err: any) {
      toast({ title: "Parse failed — fill in manually", description: err.message, variant: "destructive" });
      setStore("Unknown Store");
      setDate(new Date().toISOString().split("T")[0]);
      setNotes(conversationText);
      setParsed({ store: "Unknown Store", date: new Date().toISOString().split("T")[0], notes: conversationText });
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!user) return;
    setImporting(true);
    try {
      const { data: trip, error: tripErr } = await supabase
        .from("shopping_trips")
        .insert({
          name: store,
          store: store,
          date: date,
          notes: notes || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (tripErr || !trip) throw tripErr || new Error("Failed to create trip");

      await supabase.from("trip_members").insert({ trip_id: trip.id, user_id: user.id });

      for (const img of images) {
        try {
          const filePath = await uploadPhoto(img, user.id, trip.id);
          await supabase.from("photos").insert({
            trip_id: trip.id,
            user_id: user.id,
            file_path: filePath,
            notes: "Imported from Teams conversation",
          });
        } catch (imgErr) {
          console.error("Failed to upload image:", img.name, imgErr);
        }
      }

      setDone(true);
      toast({ title: "Import complete!", description: `Trip "${store}" created with ${images.length} photos.` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  if (done) {
    return (
      <div className="container max-w-2xl py-6">
        <div className="flex flex-col items-center py-12 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-primary" />
          <h2 className="font-serif text-xl">Import Complete</h2>
          <p className="text-sm text-muted-foreground">Your Teams conversation has been imported as a shopping trip.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setDone(false); setParsed(null); setConversationText(""); setImages([]); }}>
              Import Another
            </Button>
            <Button onClick={() => navigate("/")}>View Trips</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6">
      <button onClick={() => navigate("/profile")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Profile
      </button>

      <h1 className="mb-2 font-serif text-2xl">Import from Microsoft Teams</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Teams doesn't bundle text and images together in a single export.
        You'll need to <strong>copy the conversation text</strong> and <strong>save the images separately</strong> from the chat.
      </p>

      <div className="space-y-6">
        {/* Combined: paste text + add images */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-serif">Conversation & Photos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Conversation text</Label>
              <p className="text-xs text-muted-foreground">Select all messages in Teams → Copy → Paste here</p>
              <Textarea
                value={conversationText}
                onChange={(e) => setConversationText(e.target.value)}
                placeholder="Paste the Teams conversation here..."
                rows={6}
              />
            </div>

            <div className="space-y-2">
              <Label>Photos</Label>
              <p className="text-xs text-muted-foreground">Long-press images in Teams → Save → Select them here or drag & drop</p>
              <div
                className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
                <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1">
                  <Upload className="h-3.5 w-3.5" /> Select Images
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">or drag & drop</p>
              </div>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {images.map((img, i) => (
                    <div key={i} className="relative h-16 w-16 rounded overflow-hidden group">
                      <img src={URL.createObjectURL(img)} alt="" className="h-full w-full object-cover" />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={handleParse}
              disabled={parsing || !conversationText.trim()}
              className="w-full gap-2"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
              {parsing ? "AI is parsing..." : "Parse with AI"}
            </Button>
          </CardContent>
        </Card>

        {/* Review & import */}
        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-serif">Review & Import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">AI extracted these details — edit if needed.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Store Name</Label>
                  <Input value={store} onChange={(e) => setStore(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </div>
              </div>
              <Button onClick={handleImport} disabled={importing} className="w-full gap-2">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? "Importing..." : `Create Trip with ${images.length} Photo${images.length !== 1 ? "s" : ""}`}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

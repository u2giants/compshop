import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto } from "@/lib/supabase-helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Loader2, CheckCircle, MessageSquare } from "lucide-react";

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

  // Allow manual override after AI parse
  const [store, setStore] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setImages((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  }

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
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
      // Fallback to manual
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
            notes: `Imported from Teams conversation`,
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

      <h1 className="mb-6 font-serif text-2xl">Import from Microsoft Teams</h1>

      <div className="space-y-6">
        {/* Step 1: Paste conversation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-serif">Step 1: Paste the conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              In Teams, open the conversation → click <strong>"Forward"</strong> or select all messages → copy the text and paste it below.
            </p>
            <Textarea
              value={conversationText}
              onChange={(e) => setConversationText(e.target.value)}
              placeholder="Paste the Teams conversation here..."
              rows={8}
            />
            <Button onClick={handleParse} disabled={parsing || !conversationText.trim()} className="w-full gap-2">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
              {parsing ? "Parsing with AI..." : "Parse Conversation"}
            </Button>
          </CardContent>
        </Card>

        {/* Step 2: Upload images */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-serif">Step 2: Add photos from the conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Save the images from the Teams conversation, then select them here.
            </p>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full gap-2">
              <Upload className="h-4 w-4" /> Select Images ({images.length} selected)
            </Button>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative h-16 w-16 rounded overflow-hidden">
                    <img src={URL.createObjectURL(img)} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3: Review & import */}
        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-serif">Step 3: Review & Import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                {importing ? "Importing..." : `Import Trip with ${images.length} Photos`}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

export default function NewChinaTrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [venueType, setVenueType] = useState<string>("canton_fair");
  const [location, setLocation] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !supplier.trim()) return;
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const date = form.get("date") as string;
    const notes = form.get("notes") as string;

    try {
      const { data: trip, error } = await supabase
        .from("china_trips")
        .insert({
          name: supplier.trim(),
          supplier: supplier.trim(),
          venue_type: venueType,
          date,
          location: location || null,
          notes: notes || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from("china_trip_members").insert({ trip_id: trip.id, user_id: user.id });

      toast({ title: "China trip created!" });
      navigate(`/china/${trip.id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-lg py-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-2xl">New China Trip</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier / Factory</Label>
              <Input
                id="supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="e.g. Shenzhen Lighting Co."
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Venue Type</Label>
              <Select value={venueType} onValueChange={setVenueType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="canton_fair">Canton Fair (Trade Show)</SelectItem>
                  <SelectItem value="factory_visit">Factory Visit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().split("T")[0]} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City or booth #"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" placeholder="What products are you sourcing?" rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !supplier.trim()}>
              {submitting ? "Creating..." : "Create Trip"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

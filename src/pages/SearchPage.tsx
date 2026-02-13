import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl, PRODUCT_CATEGORIES } from "@/lib/supabase-helpers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Search, SlidersHorizontal, X } from "lucide-react";
import PhotoCard from "@/components/trip/PhotoCard";

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
  trip?: { name: string; store: string };
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState("");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<Photo[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  function escapeLikePattern(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  }

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.length > 200) {
      return;
    }
    setLoading(true);
    setSearched(true);

    let q = supabase.from("photos").select("*").order("created_at", { ascending: false }).limit(50);

    if (query.trim()) {
      const escaped = escapeLikePattern(query.trim());
      q = q.or(`product_name.ilike.%${escaped}%,brand.ilike.%${escaped}%,notes.ilike.%${escaped}%,material.ilike.%${escaped}%`);
    }
    if (category) q = q.eq("category", category);
    if (maxPrice) q = q.lte("price", Number(maxPrice));
    if (country.trim()) {
      const escaped = escapeLikePattern(country.trim());
      q = q.ilike("country_of_origin", `%${escaped}%`);
    }

    const { data } = await q;

    if (data) {
      const withUrls = await Promise.all(
        data.map(async (p) => {
          try {
            const signed_url = await getSignedPhotoUrl(p.file_path);
            return { ...p, signed_url };
          } catch {
            return { ...p, signed_url: undefined };
          }
        })
      );
      setResults(withUrls);
    }
    setLoading(false);
  }

  function clearFilters() {
    setCategory("");
    setMaxPrice("");
    setCountry("");
  }

  return (
    <div className="container py-6">
      <h1 className="mb-6 font-sans text-3xl font-semibold">Search</h1>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, brands, materials..."
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={loading}>Search</Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {showFilters && (
          <Card className="animate-fade-in">
            <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Price</Label>
                <Input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} type="number" placeholder="$" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Made In</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                  <X className="h-3 w-3" /> Clear
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </form>

      {/* Results */}
      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : searched && results.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">No results found. Try different search terms or filters.</p>
        ) : results.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((photo) => (
                <PhotoCard key={photo.id} photo={photo} onUpdated={handleSearch} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

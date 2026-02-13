import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl, PRODUCT_CATEGORIES, IMAGE_TYPES } from "@/lib/supabase-helpers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, ChevronUp, X } from "lucide-react";
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
  image_type: string | null;
  user_id: string | null;
  created_at: string;
  signed_url?: string;
  trip?: { name: string; store: string };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

export default function SearchOverlay({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [imageType, setImageType] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState("");
  const [country, setCountry] = useState("");
  const [brand, setBrand] = useState("");
  const [material, setMaterial] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [results, setResults] = useState<Photo[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.length > 200) return;
    setLoading(true);
    setSearched(true);

    let q = supabase.from("photos").select("*").order("created_at", { ascending: false }).limit(50);

    if (query.trim()) {
      const escaped = escapeLikePattern(query.trim());
      q = q.or(`product_name.ilike.%${escaped}%,brand.ilike.%${escaped}%,notes.ilike.%${escaped}%,material.ilike.%${escaped}%`);
    }
    if (category) q = q.eq("category", category);
    if (imageType) q = q.eq("image_type", imageType);
    if (maxPrice) q = q.lte("price", Number(maxPrice));
    if (country.trim()) {
      const escaped = escapeLikePattern(country.trim());
      q = q.ilike("country_of_origin", `%${escaped}%`);
    }
    if (brand.trim()) {
      const escaped = escapeLikePattern(brand.trim());
      q = q.ilike("brand", `%${escaped}%`);
    }
    if (material.trim()) {
      const escaped = escapeLikePattern(material.trim());
      q = q.ilike("material", `%${escaped}%`);
    }
    if (dimensions.trim()) {
      const escaped = escapeLikePattern(dimensions.trim());
      q = q.ilike("dimensions", `%${escaped}%`);
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
    setQuery("");
    setCategory("");
    setImageType("");
    setMaxPrice("");
    setCountry("");
    setBrand("");
    setMaterial("");
    setDimensions("");
  }

  const hasFilters = query || category || imageType || maxPrice || country || brand || material || dimensions;

  if (!open) return null;

  return (
    <div className="md:absolute md:left-0 md:right-0 md:top-full z-50 border-b bg-card md:shadow-lg animate-in slide-in-from-top-2 duration-200">
      <div className="container py-4 space-y-4">
        <form onSubmit={handleSearch} className="space-y-4">
          {/* Free-form search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, brands, materials, notes..."
              className="pl-10"
              autoFocus
            />
          </div>

          {/* Per-field filters */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              <Label className="text-xs">Image Type</Label>
              <Select value={imageType} onValueChange={setImageType}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {IMAGE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max Price</Label>
              <Input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} type="number" placeholder="$" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Made In</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Material</Label>
              <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Material" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Dimensions</Label>
              <Input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder='e.g. 12"' />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={loading} className="gap-1">
              <Search className="h-3.5 w-3.5" />
              {loading ? "Searching..." : "Search"}
            </Button>
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                Clear All
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onClose} className="ml-auto gap-1">
              <ChevronUp className="h-3.5 w-3.5" /> Close
            </Button>
          </div>
        </form>

        {/* Results inline */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : searched && results.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">No results found.</p>
        ) : results.length > 0 ? (
          <div>
            <p className="mb-3 text-sm text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-h-[60vh] overflow-y-auto pb-2">
              {results.map((photo) => (
                <PhotoCard key={photo.id} photo={photo} onUpdated={() => handleSearch()} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

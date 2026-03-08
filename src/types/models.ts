// Shared model interfaces used across the app

export interface Photo {
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
  group_id: string | null;
  section?: string | null;
  trip?: { name: string; store: string };
}

export interface Trip {
  id: string;
  name: string;
  store: string;
  date: string;
  location: string | null;
  notes: string | null;
  created_by: string | null;
}

export interface ChinaTrip {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
  date: string;
  location: string | null;
  notes: string | null;
  created_by: string | null;
}

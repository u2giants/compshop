

## Comp Shopping Intelligence App

A collaborative web app (installable as PWA on iPhone & Android) for your team to capture, organize, and analyze findings from comparison shopping trips.

### Core Structure

**Shopping Trips** — The main organizing unit. Each trip has a store name, date, location, and team members who participated. Trips live in a timeline view and can be filtered/searched.

**Photo Entries** — Within each trip, team members upload photos with structured metadata fields:
- Product name/description
- Category (furniture, textiles, lighting, etc.)
- Price
- Dimensions/size
- Country of origin
- Material
- Brand/manufacturer
- Custom notes

**Image Annotation** — Draw directly on photos with freehand tools (circles, arrows, highlights) to call out specific details like construction methods, finishes, or design elements. Annotations are saved as overlays so the original photo is preserved.

### Collaboration Features

**Team Comments** — Thread-based comments on any photo entry so team members can discuss findings, share opinions, and flag items of interest.

**Real-time Feed** — When on a trip together, the team sees a live feed of everyone's uploads organized by store, making it easy to see what's already been captured.

### Search & Discovery

**Powerful Filtering** — Search across all trips by store, date range, product category, price range, country of origin, brand, or free text. Quickly answer questions like "show me all competitor lamps under $200 made in India."

### Export & Reporting

**PDF/Spreadsheet Export** — Generate trip reports with photos and metadata for internal presentations or buying meetings. Export filtered results as spreadsheets for pricing analysis.

### Mobile-First Design

**PWA (Installable Web App)** — Works in any browser and can be installed to the home screen on both iPhone and Android. Optimized for one-handed use while walking through a store — quick photo capture, fast metadata entry, swipe-through browsing.

**Offline Support** — Draft entries can be saved locally and synced when back online.

### User Management

**Team Accounts** — Email-based login with team roles. All team members can upload and comment. Admin users can manage trips, edit/delete any entry, and run exports.

### Backend (Lovable Cloud)

The app will use Lovable Cloud for:
- **Database** — Stores trips, photo entries, annotations, comments, and user data
- **Authentication** — Email-based sign-up/login for the team
- **File Storage** — Secure storage for all uploaded photos
- **Edge Functions** — PDF report generation and any data processing


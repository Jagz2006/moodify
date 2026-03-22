# Moodify 🎵
> *music for your moment* — with real Spotify OAuth

## Files

| File | Description |
|------|-------------|
| `index.html` | All 4 screens + loading state |
| `style.css` | Full responsive styling (mobile + desktop) |
| `app.js` | Spotify OAuth PKCE flow + full API integration |

---

## How to set up (5 minutes)

### Step 1 — Create a Spotify app

1. Go to https://developer.spotify.com/dashboard
2. Click **Create app**
3. Fill in:
   - **App name**: Moodify
   - **Redirect URI**: the URL where you'll host this (e.g. `http://localhost:3000` for local, or `https://yourdomain.com/moodify/` for production)
4. Copy your **Client ID**

### Step 2 — Add your Client ID to app.js

Open `app.js` and replace line 10:

```js
const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';  // ← paste here
```

### Step 3 — Serve the files

You **must** serve over HTTP (not file://) for OAuth to work.

**Easiest local option:**
```bash
# Python
python3 -m http.server 3000

# Node
npx serve .
```

Then open http://localhost:3000

**For production:** upload to any static host (Vercel, Netlify, GitHub Pages, etc.) and make sure the Redirect URI in your Spotify app matches exactly.

---

## How it works

### Auth flow (PKCE — no backend needed)
1. User clicks "Continue with Spotify"
2. App generates a PKCE code verifier + challenge
3. User is redirected to Spotify login
4. Spotify redirects back with an auth code
5. App exchanges code for access token (client-side, secure)
6. Token stored in `sessionStorage` (expires with the tab)

### Playlist generation
1. Fetches ALL liked songs (`/me/tracks`, paginated)
2. Fetches audio features for every track (valence, energy, tempo, etc.)
3. Filters tracks by mood using audio feature thresholds
4. Picks 20 random matches
5. Creates a private playlist via `/users/{id}/playlists`
6. Adds all 20 tracks
7. Opens the playlist directly in Spotify

### Mood → audio feature mapping

| Mood      | Filters |
|-----------|---------|
| Happy     | valence > 0.6, energy > 0.5, tempo > 100 |
| Sad       | valence < 0.4, energy < 0.5, tempo < 100 |
| Energetic | energy > 0.75, tempo > 120 |
| Chill     | energy < 0.55, valence > 0.3, tempo < 115 |
| Romantic  | valence 0.4–0.7, energy < 0.7 |
| Focus     | instrumentalness > 0.2, valence < 0.75 |

---

## Scopes requested from Spotify

| Scope | Why |
|-------|-----|
| `user-library-read` | Read liked songs |
| `playlist-read-private` | Read private playlists |
| `playlist-modify-public` | Create public playlists |
| `playlist-modify-private` | Create private playlists |
| `user-read-private` | Get user ID for playlist creation |

---

## Responsive breakpoints

| Width | Layout |
|-------|--------|
| < 380px | Compact mobile |
| 380–599px | Standard mobile (full screen app) |
| 600–899px | Tablet (centered card) |
| 900–1199px | Desktop (hero panel + phone frame) |
| 1200px+ | Wide desktop (more padding) |


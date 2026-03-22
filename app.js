// ===========================
//  MOODIFY — app.js
//  Spotify OAuth + Recommendations API
// ===========================

const SPOTIFY_CLIENT_ID = "9c6f03a01f474c1bb6da25fdb2e7f996";
const SPOTIFY_REDIRECT  = "http://127.0.0.1:5173";
const SPOTIFY_SCOPES    = [
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
].join(" ");

// ── App state ──
let chosenApp          = null;
let chosenMood         = null;
let spotifyToken       = null;
let spotifyUser        = null;
let createdPlaylistUrl = null;

// ── Mood → Recommendations API parameters ──
const MOOD_SEEDS = {
  happy:     { seed_genres: "pop,happy",                    target_valence: 1.0, target_energy: 0.8, target_tempo: 120 },
  sad:       { seed_genres: "sad,acoustic",                 target_valence: 0.1, target_energy: 0.3, target_tempo: 80  },
  energetic: { seed_genres: "work-out,dance",               target_valence: 0.8, target_energy: 1.0, target_tempo: 140 },
  chill:     { seed_genres: "chill,ambient",                target_valence: 0.5, target_energy: 0.2, target_tempo: 90  },
  romantic:  { seed_genres: "romance,soul",                 target_valence: 0.7, target_energy: 0.4, target_tempo: 100 },
  focus:     { seed_genres: "study,classical",              target_instrumentalness: 0.8, target_energy: 0.4 },
};

const MOOD_META = {
  happy:     { emoji: "😄", color: "rgba(251,191,36,0.15)",  accent: "#fbbf24", label: "Happy",     blob: "#fbbf24" },
  sad:       { emoji: "😔", color: "rgba(99,102,241,0.15)",  accent: "#818cf8", label: "Sad",       blob: "#818cf8" },
  energetic: { emoji: "⚡", color: "rgba(239,68,68,0.12)",   accent: "#f87171", label: "Energetic", blob: "#f87171" },
  chill:     { emoji: "🌊", color: "rgba(45,212,191,0.12)",  accent: "#2dd4bf", label: "Chill",     blob: "#2dd4bf" },
  romantic:  { emoji: "💗", color: "rgba(244,114,182,0.12)", accent: "#f472b6", label: "Romantic",  blob: "#f472b6" },
  focus:     { emoji: "🎯", color: "rgba(139,92,246,0.15)",  accent: "#a78bfa", label: "Focus",     blob: "#a78bfa" },
};

const APP_ICONS = {
  Spotify:        { emoji: "🎵", bg: "#1DB954" },
  "Apple Music":  { emoji: "🎶", bg: "#fc3c44" },
  "YouTube Music":{ emoji: "▶️", bg: "#ff0000" },
  "Amazon Music": { emoji: "🎼", bg: "#00a8e0" },
};

// ─────────────────────────────────────────────
//  PKCE HELPERS
// ─────────────────────────────────────────────
function generateCodeVerifier(length = 128) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}

async function generateCodeChallenge(verifier) {
  const enc  = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─────────────────────────────────────────────
//  OAUTH FLOW
// ─────────────────────────────────────────────
async function startSpotifyAuth() {
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state     = crypto.randomUUID();

  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("oauth_state",   state);
  sessionStorage.setItem("chosen_app",    chosenApp || "Spotify");

  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             SPOTIFY_CLIENT_ID,
    scope:                 SPOTIFY_SCOPES,
    redirect_uri:          SPOTIFY_REDIRECT,
    state,
    code_challenge_method: "S256",
    code_challenge:        challenge,
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params;
}

// ─────────────────────────────────────────────
//  HANDLE CALLBACK
// ─────────────────────────────────────────────
async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get("code");
  const state  = params.get("state");
  const error  = params.get("error");

  if (error) { showAuthError("Spotify login was cancelled."); return false; }
  if (!code)  return false;

  if (state !== sessionStorage.getItem("oauth_state")) {
    showAuthError("Security mismatch — please try again.");
    return false;
  }

  const verifier = sessionStorage.getItem("pkce_verifier");
  chosenApp      = sessionStorage.getItem("chosen_app") || "Spotify";

  showLoadingScreen("Connecting to Spotify...");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  SPOTIFY_REDIRECT,
      client_id:     SPOTIFY_CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) { showAuthError("Token exchange failed. Please try again."); return false; }

  const data   = await res.json();
  spotifyToken = data.access_token;

  sessionStorage.setItem("spotify_token", spotifyToken);
  sessionStorage.setItem("token_expiry",  Date.now() + data.expires_in * 1000);
  if (data.refresh_token) sessionStorage.setItem("refresh_token", data.refresh_token);

  window.history.replaceState({}, "", window.location.pathname);
  await fetchUserProfile();
  return true;
}

// ─────────────────────────────────────────────
//  SPOTIFY API HELPERS
// ─────────────────────────────────────────────
async function spotifyFetch(url, options = {}) {
  const token = spotifyToken || sessionStorage.getItem("spotify_token");
  if (!token) return null;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) { showAuthError("Session expired — please log in again."); return null; }
  if (!res.ok) {
    const errBody = await res.text();
    console.error("Spotify API error", res.status, url, errBody);
    return null;
  }
  if (res.status === 204) return {};
  return res.json();
}

async function fetchUserProfile() {
  const res = await spotifyFetch("https://api.spotify.com/v1/me");
  if (res) {
    spotifyUser = res;
    const el = document.getElementById("spotifyUserName");
    if (el) el.textContent = res.display_name || res.id;
  }
}

async function fetchAllLikedSongs() {
  let tracks = [];
  let url    = "https://api.spotify.com/v1/me/tracks?limit=50";
  while (url) {
    const data = await spotifyFetch(url);
    if (!data || !data.items) break;
    tracks = tracks.concat(data.items.map((i) => i.track));
    url = data.next;
  }
  return tracks.filter((t) => t && t.id);
}

// Get mood-matched recommendations seeded by user's own liked songs
async function fetchMoodRecommendations(likedTracks, mood) {
  // Use 3 random liked songs as seeds so results stay close to user's taste
  const seedTracks = pickRandom(likedTracks, 3).map((t) => t.id).join(",");
  const moodParams = MOOD_SEEDS[mood] || MOOD_SEEDS.happy;

  const params = new URLSearchParams({
    seed_tracks: seedTracks,
    limit: 50,
    ...moodParams,
  });

  console.log("Fetching recommendations with params:", params.toString());
  const data = await spotifyFetch(`https://api.spotify.com/v1/recommendations?${params}`);
  console.log("Recommendations response:", data);
  return data?.tracks || [];
}

function pickRandom(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

async function createMoodPlaylist(mood, trackUris) {
  const meta   = MOOD_META[mood];
  const userId = spotifyUser?.id;

  console.log("Creating playlist for user:", userId);
  console.log("Track count:", trackUris.length);

  if (!userId) { console.error("No user ID!"); return null; }

  const playlist = await spotifyFetch(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    {
      method: "POST",
      body: JSON.stringify({
        name:        `Moodify · ${meta.label}`,
        description: `Auto-generated by Moodify for your ${meta.label.toLowerCase()} mood 🎵`,
        public:      false,
      }),
    }
  );

  console.log("Playlist created:", playlist);
  if (!playlist) { console.error("Playlist creation failed!"); return null; }

  for (let i = 0; i < trackUris.length; i += 100) {
    const result = await spotifyFetch(
      `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`,
      {
        method: "POST",
        body: JSON.stringify({ uris: trackUris.slice(i, i + 100) }),
      }
    );
    console.log("Tracks added batch", i, result);
  }

  return playlist;
}

// ─────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────
function showLoadingScreen(message) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  let loading = document.getElementById("sLoading");
  if (!loading) {
    loading = document.createElement("div");
    loading.id        = "sLoading";
    loading.className = "screen active";
    loading.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-msg" id="loadingMsg">${message}</div>
    `;
    document.getElementById("moodifyApp").appendChild(loading);
  } else {
    loading.classList.add("active");
  }
  if (message) updateLoadingMsg(message);
}

function hideLoadingScreen() {
  const el = document.getElementById("sLoading");
  if (el) el.classList.remove("active");
}

function updateLoadingMsg(msg) {
  const el = document.getElementById("loadingMsg");
  if (el) el.textContent = msg;
}

function showAuthError(msg) {
  hideLoadingScreen();
  goTo(2);
  const notice = document.querySelector(".login-notice");
  if (notice) { notice.textContent = "⚠️ " + msg; notice.style.color = "#f87171"; }
}

// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────
function goTo(n) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const next = document.getElementById("s" + n);
  if (!next) return;
  next.classList.add("active");
  if (n === 2) updateLoginScreen();
  if (n === 4) startBuildPlaylist();
}

// ─────────────────────────────────────────────
//  SCREEN 1 — Select app
// ─────────────────────────────────────────────
function selectApp(el, name) {
  document.querySelectorAll(".app-btn").forEach((b) => b.classList.remove("selected"));
  el.classList.add("selected");
  chosenApp = name;
  document.getElementById("s1next").disabled = false;
}

// ─────────────────────────────────────────────
//  SCREEN 2 — Login
// ─────────────────────────────────────────────
function updateLoginScreen() {
  if (!chosenApp) return;
  const info = APP_ICONS[chosenApp] || { emoji: "🎵", bg: "#1DB954" };
  const icon = document.getElementById("loginIcon");
  icon.textContent      = info.emoji;
  icon.style.background = info.bg;
  document.getElementById("loginName").textContent    = chosenApp;
  document.getElementById("loginBtnName").textContent = chosenApp;

  const oauthBtn   = document.getElementById("spotifyOAuthBtn");
  const comingSoon = document.getElementById("comingSoonMsg");
  const emailFields= document.getElementById("emailFields");

  if (chosenApp === "Spotify") {
    if (oauthBtn)    oauthBtn.style.display    = "block";
    if (comingSoon)  comingSoon.style.display   = "none";
    if (emailFields) emailFields.style.display  = "none";
  } else {
    if (oauthBtn)    oauthBtn.style.display    = "none";
    if (comingSoon)  comingSoon.style.display   = "block";
    if (emailFields) emailFields.style.display  = "none";
  }

  const token  = sessionStorage.getItem("spotify_token");
  const expiry = sessionStorage.getItem("token_expiry");
  if (token && expiry && Date.now() < Number(expiry)) {
    spotifyToken = token;
    showLoggedInState();
  }
}

function showLoggedInState() {
  const card = document.querySelector(".login-card");
  if (!card) return;
  const name = spotifyUser?.display_name || "your account";
  card.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px 0;">
      <div style="width:52px;height:52px;border-radius:50%;background:rgba(29,185,84,0.2);border:2px solid #1DB954;display:flex;align-items:center;justify-content:center;font-size:22px;color:#1DB954;">✓</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.08em;">Connected as</div>
      <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#fff;">${name}</div>
      <button class="btn-primary" style="margin-top:8px;" onclick="goTo(3)">Continue →</button>
      <button class="back-btn" style="margin-top:4px;" onclick="logOut()">Log out</button>
    </div>
  `;
}

function logOut() {
  sessionStorage.clear();
  spotifyToken = null;
  spotifyUser  = null;
  window.location.reload();
}

// ─────────────────────────────────────────────
//  SCREEN 3 — Select mood
// ─────────────────────────────────────────────
function selectMood(el, mood) {
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
  el.classList.add("selected");
  chosenMood = mood;
  const meta = MOOD_META[mood];
  if (meta) {
    document.getElementById("blob1").style.background = meta.blob;
    const heroBlob = document.getElementById("heroBlob");
    if (heroBlob) heroBlob.style.background = meta.blob;
  }
  document.getElementById("s3next").disabled = false;
}

// ─────────────────────────────────────────────
//  SCREEN 4 — Build playlist using Recommendations API
// ─────────────────────────────────────────────
async function startBuildPlaylist() {
  const mood = chosenMood || "happy";
  const meta = MOOD_META[mood];

  showLoadingScreen("Fetching your liked songs...");

  try {
    // 1. Get all liked songs
    const allTracks = await fetchAllLikedSongs();
    console.log("Liked songs fetched:", allTracks.length);

    if (allTracks.length === 0) {
      hideLoadingScreen();
      goTo(3);
      alert("No liked songs found. Like some songs on Spotify first!");
      return;
    }

    // 2. Get mood-matched recommendations seeded by liked songs
    updateLoadingMsg("Finding mood-matched songs...");
    const recommendations = await fetchMoodRecommendations(allTracks, mood);
    console.log("Recommendations fetched:", recommendations.length);

    // 3. Prefer tracks that are already in the user's liked songs
    const likedIds = new Set(allTracks.map((t) => t.id));
    const fromLibrary    = recommendations.filter((t) => likedIds.has(t.id));
    const notFromLibrary = recommendations.filter((t) => !likedIds.has(t.id));

    console.log("Matched from library:", fromLibrary.length);
    console.log("New recommendations:", notFromLibrary.length);

    // Fill up to 20: prioritise library matches, then pad with recommendations
    let selected = [...pickRandom(fromLibrary, Math.min(20, fromLibrary.length))];
    if (selected.length < 20) {
      const needed = 20 - selected.length;
      selected = [...selected, ...pickRandom(notFromLibrary, needed)];
    }

    // Final fallback: just use liked songs if recommendations totally failed
    if (selected.length === 0) {
      selected = pickRandom(allTracks, 20);
    }

    const display = selected.slice(0, 6);

    // 4. Create the playlist on Spotify
    updateLoadingMsg("Creating your Spotify playlist...");
    const uris     = selected.map((t) => `spotify:track:${t.id}`);
    const playlist = await createMoodPlaylist(mood, uris);

    createdPlaylistUrl = playlist?.external_urls?.spotify || null;
    if (createdPlaylistUrl) sessionStorage.setItem("playlist_url", createdPlaylistUrl);

    hideLoadingScreen();
    renderPlaylistScreen(mood, meta, display, playlist);

  } catch (err) {
    console.error("Build playlist error:", err);
    hideLoadingScreen();
    goTo(3);
    alert("Something went wrong. Please try again.");
  }
}

function renderPlaylistScreen(mood, meta, tracks, playlist) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("s4").classList.add("active");

  document.getElementById("playlistTitle").textContent = "Your " + meta.label + " Playlist";
  document.getElementById("plName").textContent        = "Moodify · " + meta.label;

  const totalSec = tracks.reduce((acc, t) => acc + Math.round((t.duration_ms || 0) / 1000), 0);
  const totalMin = Math.round(totalSec / 60);
  document.getElementById("plMeta").textContent =
    "20 songs · ~" + totalMin + "+ min · saved to Spotify";

  const icon = document.getElementById("successIcon");
  icon.style.borderColor = meta.accent;
  icon.style.background  = meta.color;
  icon.style.color       = meta.accent;

  const art = document.getElementById("playlistArt");
  art.textContent      = meta.emoji;
  art.style.background = meta.color;

  document.getElementById("openInApp").textContent = "Spotify";

  const list = document.getElementById("trackList");
  list.innerHTML = tracks.map((t, i) => {
    const ms     = t.duration_ms || 0;
    const dur    = Math.floor(ms / 60000) + ":" + String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const artist = t.artists ? t.artists.map((a) => a.name).join(", ") : "Unknown";
    return `
      <div class="track">
        <span class="track-num">${i + 1}</span>
        <div class="track-info">
          <div class="track-name">${t.name}</div>
          <div class="track-artist">${artist}</div>
        </div>
        <span class="track-dur">${dur}</span>
      </div>
    `;
  }).join("");
}

// ─────────────────────────────────────────────
//  OPEN IN SPOTIFY
// ─────────────────────────────────────────────
function openApp() {
  const url = createdPlaylistUrl || sessionStorage.getItem("playlist_url");
  if (url) {
    window.open(url, "_blank");
  } else {
    alert('Check your Spotify app — look for "Moodify · ' + (MOOD_META[chosenMood]?.label || '') + '" in Your Library!');
  }
}

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
(async function boot() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("code")) {
    const ok = await handleCallback();
    if (ok) { chosenApp = sessionStorage.getItem("chosen_app") || "Spotify"; goTo(3); }
  } else {
    const token  = sessionStorage.getItem("spotify_token");
    const expiry = sessionStorage.getItem("token_expiry");
    if (token && expiry && Date.now() < Number(expiry)) {
      spotifyToken = token;
      chosenApp    = sessionStorage.getItem("chosen_app") || "Spotify";
      await fetchUserProfile();
    }
    goTo(1);
  }
})();
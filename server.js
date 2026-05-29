import fs from "fs";
import express from "express";
import { chromium } from "playwright";

const app = express();
app.use((req, res, next) => {
 res.setHeader("Access-Control-Allow-Origin", "*");
 res.setHeader("Access-Control-Allow-Headers", "*");
 res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
 if (req.method === "OPTIONS") return res.sendStatus(200);
 next();
});
const PORT = Number(process.env.PORT || 7000);
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const MAX_ITEMS_PER_TYPE = Number(process.env.MAX_ITEMS_PER_TYPE || 40);
const CACHE_TTL_HOURS = Number(process.env.CACHE_TTL_HOURS || 12);
const CACHE_FILE = "cache.json";

const SOURCES = {
  movie: {
    catalogId: "filmbaze_cz_dabing",
    name: "Filmbaze CZ dabing - filmy",
    url: "https://filmbaze.cz/novinky-s-ceskym-dabingem-na-netu",
    tmdbType: "movie"
  },
  series: {
    catalogId: "filmbaze_cz_serialy",
    name: "Filmbaze v češtině - seriály",
    url: "https://filmbaze.cz/oblibene-serialy-v-cestine",
    tmdbType: "tv"
  }
};

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn("Cache save failed:", err.message);
  }
}

const cache = loadCache();

function isFresh(entry, ttlHours = CACHE_TTL_HOURS) {
  if (!entry?.ts) return false;
  return Date.now() - entry.ts < ttlHours * 60 * 60 * 1000;
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/^Poster for\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/CZ|SK|dabing|titulky|online|ke stažení|zdarma/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function looksLikeTitle(text) {
  if (!text || text.length < 2 || text.length > 90) return false;
  const blacklist = [
    "Filmbaze", "Přihlášení", "Registrace", "Cookies", "Domů", "Filmy",
    "Seriály", "Novinky", "Hledat", "Menu", "Facebook", "Instagram", "YouTube",
    "Komentáře", "Privacy", "Souhlas", "Nastavení", "Přidat", "Trailer"
  ];
  return !blacklist.some((b) => text.toLowerCase().includes(b.toLowerCase()));
}

async function scrapeTitles(sourceKey) {
  const source = SOURCES[sourceKey];
  const cacheKey = `scrape:${sourceKey}`;
  if (isFresh(cache[cacheKey])) return cache[cacheKey].titles;

  console.log("Scraping", source.url);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
  });

  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1000);
  }

  const raw = await page.evaluate(() => {
    const out = [];
    const selectors = ["a", "h1", "h2", "h3", "h4", "img", ".title", ".name"];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        [el.textContent, el.getAttribute("title"), el.getAttribute("alt")]
          .map((v) => v?.trim())
          .filter(Boolean)
          .forEach((v) => out.push(v));
      });
    }
    return [...new Set(out)];
  });

  await browser.close();
  const titles = [...new Set(raw.map(cleanTitle).filter(looksLikeTitle))].slice(0, MAX_ITEMS_PER_TYPE);
  console.log(`Found ${titles.length} ${sourceKey} titles`, titles.slice(0, 20));

  cache[cacheKey] = { ts: Date.now(), titles };
  saveCache(cache);
  return titles;
}

async function tmdbSearch(title, stremioType) {
  if (!TMDB_API_KEY) return null;
  const tmdbType = SOURCES[stremioType].tmdbType;
  const key = `tmdb:${tmdbType}:${title.toLowerCase()}`;
  if (cache[key] !== undefined) return cache[key];

  const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${encodeURIComponent(TMDB_API_KEY)}&query=${encodeURIComponent(title)}&language=cs-CZ&include_adult=false`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("TMDB error", res.status, title);
    return null;
  }
  const data = await res.json();
  const item = data.results?.[0] || null;
  cache[key] = item;
  saveCache(cache);
  await new Promise((r) => setTimeout(r, 200));
  return item;
}

function posterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : undefined;
}

function backgroundUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w1280${path}` : undefined;
}

function fallbackId(type, title) {
  const safe = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `filmbaze:${type}:${safe}`;
}

function makeMetaPreview(title, type, tmdb) {
  const isSeries = type === "series";
  const id = tmdb ? `tmdb:${isSeries ? "tv" : "movie"}:${tmdb.id}` : fallbackId(type, title);
  const name = tmdb ? (tmdb.title || tmdb.name || title) : title;
  const yearRaw = tmdb ? (tmdb.release_date || tmdb.first_air_date || "").slice(0, 4) : "";
  return {
    id,
    type,
    name,
    poster: posterUrl(tmdb?.poster_path),
    background: backgroundUrl(tmdb?.backdrop_path),
    description: tmdb?.overview || `Titul z katalógu Filmbaze: ${title}`,
    releaseInfo: yearRaw || undefined,
    imdbRating: tmdb?.vote_average ? String(Math.round(tmdb.vote_average * 10) / 10) : undefined
  };
}

async function buildCatalog(type) {
  const cacheKey = `catalog:${type}`;
  if (isFresh(cache[cacheKey])) return cache[cacheKey].metas;

  const titles = await scrapeTitles(type);
  const metas = [];
  for (const title of titles) {
    const tmdb = await tmdbSearch(title, type);
    metas.push(makeMetaPreview(title, type, tmdb));
  }
  cache[cacheKey] = { ts: Date.now(), metas };
  saveCache(cache);
  return metas;
}

const manifest = {
 id: "community.filmbaze.direct.catalog",
 version: "2.0.2",
 name: "Filmbaze CZ SK",
 description: "Filmbaze katalogy pre Stremio",
 resources: ["catalog", "meta"],
 types: ["movie", "series"],
 catalogs: [
   {
     type: "movie",
     id: "filmbaze_cz_dabing",
     name: "Filmbaze CZ filmy"
   },
   {
     type: "series",
     id: "filmbaze_cz_serialy",
     name: "Filmbaze CZ serialy"
   }
 ]
};

app.get("/", (_req, res) => res.redirect("/manifest.json"));
app.get("/manifest.json", (_req, res) => res.json(manifest));

app.get("/catalog/:type/:id.json", async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === "movie" && id === SOURCES.movie.catalogId) return res.json({ metas: await buildCatalog("movie") });
    if (type === "series" && id === SOURCES.series.catalogId) return res.json({ metas: await buildCatalog("series") });
    return res.json({ metas: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ metas: [], error: err.message });
  }
});

app.get("/meta/:type/:id.json", async (req, res) => {
  try {
    const { type, id } = req.params;
    const metas = await buildCatalog(type === "series" ? "series" : "movie");
    const meta = metas.find((m) => m.id === id) || { id, type, name: id, description: "Metadata not found" };
    res.json({ meta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ meta: { id: req.params.id, type: req.params.type, name: "Error", description: err.message } });
  }
});

app.get("/debug/catalog", async (_req, res) => {
  const movies = await buildCatalog("movie");
  const series = await buildCatalog("series");
  res.json({ tmdbConfigured: Boolean(TMDB_API_KEY), movieCount: movies.length, seriesCount: series.length, movies: movies.slice(0, 10), series: series.slice(0, 10) });
});

app.get("/logo.png", (_req, res) => res.status(404).end());

app.listen(PORT, () => {
  console.log(`Filmbaze Stremio addon running on ${PUBLIC_URL}/manifest.json`);
});

import fs from "fs";
import { chromium } from "playwright";

const MOVIES_URL =
  "https://filmbaze.cz/novinky-s-ceskym-dabingem-na-netu";

const SERIES_URL =
  "https://filmbaze.cz/oblibene-serialy-v-cestine";

const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  throw new Error("Missing TMDB_API_KEY");
}

function cleanTitle(title) {
  return title
    .replace(/^Poster for\s+/i, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(
      /CZ|SK|dabing|titulky|online|zdarma/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isValidTitle(title) {
  if (!title) return false;

  const blacklist = [
    "Filmbaze",
    "Přihlášení",
    "Registrace",
    "Domů",
    "Filmy",
    "Seriály",
    "Facebook",
    "Instagram",
    "Komentáře",
    "Menu",
    "Hledat"
  ];

  if (
    blacklist.some((x) =>
      title.toLowerCase().includes(
        x.toLowerCase()
      )
    )
  ) {
    return false;
  }

  return (
    title.length > 1 &&
    title.length < 120
  );
}

async function scrape(url) {
  console.log("Scraping", url);

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
  });

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 4000);

    await page.waitForTimeout(1500);

    try {
      const buttons = await page.$$("button");

      for (const btn of buttons) {
        const text = await btn.textContent();

        if (
          text &&
          (
            text.includes("Načítať") ||
            text.includes("Načíst") ||
            text.includes("další") ||
            text.includes("více")
          )
        ) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
    } catch {}
  }

  const raw = await page.evaluate(() => {
    const out = [];

    document
      .querySelectorAll("img, a, h2, h3")
      .forEach((el) => {
        const values = [
          el.textContent,
          el.getAttribute("title"),
          el.getAttribute("alt")
        ];

        values.forEach((v) => {
          const text = v?.trim();

          if (text) {
            out.push(text);
          }
        });
      });

    return [...new Set(out)];
  });

  await browser.close();

  const cleaned = [
    ...new Set(
      raw
        .map(cleanTitle)
        .filter(isValidTitle)
    )
  ];

  console.log(
    `Found ${cleaned.length} titles`
  );

  return cleaned;
}

async function tmdbSearch(title, type) {
  const media =
    type === "series"
      ? "tv"
      : "movie";

  const url =
    `https://api.themoviedb.org/3/search/${media}` +
    `?api_key=${TMDB_API_KEY}` +
    `&query=${encodeURIComponent(title)}`;

  const res = await fetch(url);

  if (!res.ok) {
    console.log(
      `TMDB error ${res.status}`
    );
    return null;
  }

  const data = await res.json();

  return data.results?.[0] || null;
}

async function buildMeta(title, type) {
  const tmdb = await tmdbSearch(
    title,
    type
  );

  if (!tmdb) {
    return null;
  }

  return {
    id: `tmdb:${tmdb.id}`,
    type:
      type === "series"
        ? "series"
        : "movie",
    name:
      tmdb.title ||
      tmdb.name ||
      title,
    poster: tmdb.poster_path
      ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`
      : undefined,
    posterShape: "poster"
  };
}

async function main() {
  const movieTitles =
    await scrape(MOVIES_URL);

  const seriesTitles =
    await scrape(SERIES_URL);

  console.log(
    "Movies:",
    movieTitles.length
  );

  console.log(
    "Series:",
    seriesTitles.length
  );

  const movies = [];
  const series = [];

  const usedMovieIds = new Set();
  const usedSeriesIds = new Set();

  for (const title of movieTitles.slice(0, 200)) {
    const meta = await buildMeta(
      title,
      "movie"
    );

    if (
      meta &&
      !usedMovieIds.has(meta.id)
    ) {
      usedMovieIds.add(meta.id);
      movies.push(meta);
    }
  }

  for (const title of seriesTitles.slice(0, 200)) {
    const meta = await buildMeta(
      title,
      "series"
    );

    if (
      meta &&
      !usedSeriesIds.has(meta.id)
    ) {
      usedSeriesIds.add(meta.id);
      series.push(meta);
    }
  }

  fs.writeFileSync(
    "catalog-cache.json",
    JSON.stringify(
      {
        movies,
        series
      },
      null,
      2
    )
  );

  console.log(
    `Saved ${movies.length} movies`
  );

  console.log(
    `Saved ${series.length} series`
  );

  console.log("Cache updated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

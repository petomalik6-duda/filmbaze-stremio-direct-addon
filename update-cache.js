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
    .replace(/\s+/g, " ")
    .trim();
}

async function scrape(url) {
  console.log("Scraping", url);

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1000);
  }

  const titles = await page.evaluate(() => {
    const out = [];

    document
      .querySelectorAll("img")
      .forEach((el) => {
        const alt = el
          .getAttribute("alt")
          ?.trim();

        if (
          alt &&
          alt.length > 1 &&
          alt.length < 100
        ) {
          out.push(alt);
        }
      });

    return [...new Set(out)];
  });

  await browser.close();

  return [...new Set(
    titles.map(cleanTitle)
  )];
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

  for (const title of movieTitles.slice(0, 50)) {
    const meta = await buildMeta(
      title,
      "movie"
    );

    if (meta) {
      movies.push(meta);
    }
  }

  for (const title of seriesTitles.slice(0, 50)) {
    const meta = await buildMeta(
      title,
      "series"
    );

    if (meta) {
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

  console.log("Cache updated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

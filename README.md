# Filmbaze Stremio Direct Addon

Vlastný Stremio katalóg z Filmbaze.

Obsahuje 2 katalógy:

- Filmbaze CZ dabing - filmy
- Filmbaze v češtině - seriály

Addon poskytuje iba katalóg a metadáta. Neposkytuje streamy.

## Lokálne spustenie

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm start
```

Otvor:

```txt
http://127.0.0.1:7000/manifest.json
```

## Render deploy

1. Nahraj projekt na GitHub.
2. Render → New Web Service.
3. Build command:

```bash
npm install && npx playwright install chromium --with-deps
```

4. Start command:

```bash
npm start
```

5. Environment variables:

```env
TMDB_API_KEY=...
PUBLIC_URL=https://tvoja-render-url.onrender.com
MAX_ITEMS_PER_TYPE=40
CACHE_TTL_HOURS=12
```

6. Otestuj:

```txt
https://tvoja-render-url.onrender.com/manifest.json
https://tvoja-render-url.onrender.com/debug/catalog
```

7. Do Stremio pridaj manifest URL:

```txt
https://tvoja-render-url.onrender.com/manifest.json
```

## Endpointy

```txt
/manifest.json
/catalog/movie/filmbaze_cz_dabing.json
/catalog/series/filmbaze_cz_serialy.json
/meta/movie/:id.json
/meta/series/:id.json
/debug/catalog
```

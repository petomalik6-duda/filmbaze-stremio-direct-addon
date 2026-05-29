import express from "express";
import fs from "fs";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

const manifest = {
  id: "community.filmbaze.cached.catalog",
  version: "3.0.0",
  name: "Filmbaze CZ SK",
  description: "Filmbaze katalogy pre Stremio",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "filmbaze_movies",
      name: "Filmbaze CZ filmy"
    },
    {
      type: "series",
      id: "filmbaze_series",
      name: "Filmbaze CZ seriály"
    }
  ]
};

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

function loadCache() {
  if (!fs.existsSync("catalog-cache.json")) {
    return {
      movies: [],
      series: []
    };
  }

  return JSON.parse(
    fs.readFileSync("catalog-cache.json", "utf8")
  );
}

app.get("/debug/catalog", (req, res) => {
  res.json(loadCache());
});

app.get("/catalog/:type/:id.json", (req, res) => {
  try {
    const cache = loadCache();

    if (req.params.type === "movie") {
      return res.json({
        metas: cache.movies || []
      });
    }

    return res.json({
      metas: cache.series || []
    });
  } catch (err) {
    console.error(err);

    return res.json({
      metas: []
    });
  }
});

app.get("/meta/:type/:id.json", (req, res) => {
  const cache = loadCache();

  const all = [
    ...(cache.movies || []),
    ...(cache.series || [])
  ];

  const meta = all.find(
    (m) => m.id === req.params.id
  );

  res.json({
    meta: meta || null
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(
    `Addon running on port ${PORT}`
  );
});

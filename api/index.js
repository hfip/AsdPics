const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

// حل مشكلة توافق node-fetch الحديثة مع نظام require
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 7001;
const BASE = "https://qeseh.net";
const WATCH_BASE = "https://qesen.net";
const FALLBACK_POSTER =
  "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png";

// ─── Cache ─────────────────────────────────────────────────────────────────────
const pageCache = new Map();
const streamCache = new Map();
const PAGE_TTL = 5 * 60 * 1000;
const STREAM_TTL = 20 * 60 * 1000; // 20 دقيقة (token يدوم 12 ساعة)

async function fetchHtml(url, referer = BASE) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ar,en;q=0.9",
      Referer: referer,
    },
    compress: true,
  });
  const html = await res.text();
  pageCache.set(url, { html, ts: Date.now() });
  return html;
}

function extractBgImage(style) {
  if (!style) return "";
  const m = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  return m ? m[1] : "";
}

function encodeSlug(slug) {
  return encodeURIComponent(slug);
}

function decodeSlug(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

// ─── Catalog definitions ───────────────────────────────────────────────────────
const CATALOGS = [
  {
    id: "q-latest",
    name: "أحدث الحلقات",
    type: "series",
    url: `${BASE}/latest-episodes/`,
    mode: "latest",
  },
  {
    id: "q-arsiv",
    name: "مسلسلات كاملة",
    type: "series",
    url: `${BASE}/category/arsiv/`,
    mode: "article",
  },
  {
    id: "q-movies",
    name: "أفلام تركية",
    type: "movie",
    url: `${BASE}/category/filmler/`,
    mode: "article",
  },
];

const MANIFEST = {
  id: "community.qeseh.addon",
  version: "1.1.0",
  name: "قصة عشق | Qeseh",
  description: "مسلسلات وأفلام تركية مدبلجة ومترجمة من موقع قصة عشق — مع بث مباشر m3u8",
  logo: "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png",
  background: "https://qeseh.net/wp-content/uploads/2026/03/Kabiha-large.jpg",
  types: ["series", "movie"],
  catalogs: CATALOGS.map((c) => ({
    type: c.type,
    id: c.id,
    name: c.name,
    extra: [{ name: "skip", isRequired: false }],
  })),
  resources: [
    { name: "catalog", types: ["series", "movie"] },
    { name: "meta", types: ["series", "movie"], idPrefixes: ["qeseh:"] },
    { name: "stream", types: ["series", "movie"], idPrefixes: ["qeseh:"] },
  ],
  idPrefixes: ["qeseh:"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

// ─── Catalog scraper ───────────────────────────────────────────────────────────
async function getCatalogItems(catalogId) {
  const catalog = CATALOGS.find((c) => c.id === catalogId);
  if (!catalog) return [];

  const html = await fetchHtml(catalog.url);
  const $ = load(html);
  const items = [];
  const seen = new Set();

  if (catalog.mode === "latest") {
    $("a[href*='/clarus/']").each((_i, el) => {
      const linkEl = $(el);
      const href = linkEl.attr("href") || "";
      const rawTitle = linkEl.attr("title") || "";
      if (!href || !rawTitle) return;

      const rawEpSlug = href.replace(/.*\/clarus\//, "").replace(/\/$/, "");
      if (!rawEpSlug) return;
      const epSlug = decodeSlug(rawEpSlug);

      const seriesKey = epSlug.replace(/-episode-\d+$/, "");
      if (seen.has(seriesKey)) return;
      seen.add(seriesKey);

      const seriesName = rawTitle
        .replace(/ - قصة عشق$/, "")
        .replace(/\s+الحلقة\s+\d+$/, "")
        .trim();
      if (!seriesName) return;

      const bgStyle = linkEl.find(".imgBg").attr("style") || "";
      const poster = extractBgImage(bgStyle) || FALLBACK_POSTER;

      items.push({
        id: `qeseh:ep-series:${encodeSlug(epSlug)}`,
        type: "series",
        name: seriesName,
        poster,
      });
    });
  } else {
    const pathPattern = catalog.type === "movie" ? "/movies/" : "/yeni-show/";
    $("article").each((_i, el) => {
      const article = $(el);
      const linkEl = article.find(`a[href*="${pathPattern}"]`).first();
      const href = linkEl.attr("href") || "";
      const rawTitle =
        linkEl.attr("title") || linkEl.find(".title").text();
      if (!href || !rawTitle) return;

      const slug = href
        .replace(/.*\/(yeni-show|movies)\//, "")
        .replace(/\/$/, "");
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const name = rawTitle.replace(/ - قصة عشق$/, "").trim();
      const bgStyle = article.find(".imgBg").attr("style") || "";
      const poster = extractBgImage(bgStyle) || FALLBACK_POSTER;

      items.push({
        id: `qeseh:${catalog.type}:${encodeSlug(slug)}`,
        type: catalog.type,
        name,
        poster,
      });
    });
  }

  return items;
}

// ─── Episode parser ────────────────────────────────────────────────────────────
function parseEpisodes($, seriesId) {
  const episodes = [];
  const seen = new Set();

  $("a[href*='/clarus/']").each((_i, el) => {
    const linkEl = $(el);
    const href = linkEl.attr("href") || "";
    const rawTitle = linkEl.attr("title") || "";
    if (!href || !rawTitle) return;

    const rawEpSlug = href.replace(/.*\/clarus\//, "").replace(/\/$/, "");
    if (!rawEpSlug) return;
    const epSlug = decodeSlug(rawEpSlug);
    if (seen.has(epSlug)) return;
    seen.add(epSlug);

    const epNumMatch = epSlug.match(/(\d+)$/);
    const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : episodes.length + 1;

    const epTitle =
      rawTitle.replace(/ - قصة عشق$/, "").replace(/^مسلسل\s+/, "").trim() ||
      `الحلقة ${epNum}`;
    const titleMatch = epTitle.match(/الحلقة\s+\d+/);
    const cleanTitle = titleMatch ? titleMatch[0] : `الحلقة ${epNum}`;

    episodes.push({
      id: `${seriesId}:${encodeSlug(epSlug)}`,
      title: cleanTitle,
      season: 1,
      episode: epNum,
      episodeSlug: epSlug,
      episodeUrl: `${BASE}/clarus/${rawEpSlug}/`,
    });
  });

  episodes.sort((a, b) => a.episode - b.episode);
  return episodes;
}

// ─── Meta fetcher ──────────────────────────────────────────────────────────────
async function getMeta(type, slug) {
  let pageUrl;
  if (type === "ep-series") {
    pageUrl = `${BASE}/clarus/${slug}/`;
  } else if (type === "movie") {
    pageUrl = `${BASE}/movies/${slug}/`;
  } else {
    pageUrl = `${BASE}/yeni-show/${slug}/`;
  }

  const html = await fetchHtml(pageUrl);
  const $ = load(html);

  let name =
    $("h1").first().text().trim() ||
    $("title").first().text().replace("- قصة عشق", "").trim();
  if (type === "ep-series") {
    name = name.replace(/\s+الحلقة\s+\d+$/, "").trim();
  }
  if (!name) return null;

  const coverStyle =
    $(".singleSeries .cover .img").attr("style") ||
    $(".cover .img").attr("style") ||
    $(".modern-player-container").attr("style") ||
    $(".posterThumb .imgBg").first().attr("style") ||
    $(".imgBg").first().attr("style") ||
    "";
  const poster = extractBgImage(coverStyle) || FALLBACK_POSTER;

  const description = $(".singleSeries .info .desc, .sinopsis, .overview")
    .first()
    .text()
    .trim();

  const seriesId = `qeseh:${type}:${encodeSlug(slug)}`;

  if (type === "movie") {
    return {
      id: seriesId,
      type: "movie",
      name,
      poster,
      description,
      episodes: [
        {
          id: `${seriesId}:play`,
          title: name,
          season: 1,
          episode: 1,
          episodeSlug: slug,
          episodeUrl: pageUrl,
        },
      ],
    };
  }

  const episodes = parseEpisodes($, seriesId);
  return { id: seriesId, type: "series", name, poster, description, episodes };
}

// ─── M3U8 Extractor ───────────────────────────────────────────────────────────
async function extractPlayerData(episodeUrl) {
  try {
    const html = await fetchHtml(episodeUrl);
    const hrefMatch = html.match(
      /href="(https?:\/\/qesen\.net\/watch\?post=([A-Za-z0-9+/=]+))"/
    );
    if (!hrefMatch) return null;

    const watchUrl = hrefMatch[1];
    const postBase64 = hrefMatch[2];
    const decoded = JSON.parse(
      Buffer.from(postBase64, "base64").toString("utf-8")
    );

    if (!decoded.servers || !Array.isArray(decoded.servers)) return null;

    return {
      watchUrl,
      postBase64,
      servers: decoded.servers,
      postID: decoded.postID,
      type: decoded.type,
    };
  } catch {
    return null;
  }
}

async function extractM3u8FromEmbed(embedUrl, fetchReferer) {
  try {
    const html = await fetchHtml(embedUrl, fetchReferer);
    if (!html || html.length < 100) return null;

    const imgMatch = html.match(
      /https?:\/\/([a-z0-9-]+\.cdnz\.online)\/i\/(\d+)\/(\d+)\/([a-z0-9]+)\.jpg/i
    );
    if (!imgMatch) return null;

    const cdnHost = imgMatch[1];
    const folder1 = imgMatch[2];
    const folder2 = imgMatch[3];
    const serverId = imgMatch[4];

    if (!html.includes(".split('|')))")) return null;

    const beforeSplit = html.slice(0, html.lastIndexOf(".split('|')))"));
    const lastQ = beforeSplit.lastIndexOf("'");
    const prevQ = beforeSplit.lastIndexOf("'", lastQ - 1);
    if (lastQ < 0 || prevQ < 0) return null;

    const keys = beforeSplit.slice(prevQ + 1, lastQ).split("|");
    const sp43200Idx = keys.indexOf("43200");
    const m3u8Idx = keys.indexOf("m3u8");
    if (sp43200Idx < 0 || m3u8Idx < 0 || m3u8Idx <= sp43200Idx) return null;

    const token = keys
      .slice(sp43200Idx + 1, m3u8Idx)
      .filter((k) => k.length > 0)
      .join("");
    if (!token) return null;

    return `https://${cdnHost}/hls2/${folder1}/${folder2}/${serverId}_/urlset/master.m3u8?t=${token}&sp=43200`;
  } catch {
    return null;
  }
}

function buildEmbedInfo(serverName, serverId) {
  switch (serverName.toLowerCase()) {
    case "arab hd":
      return {
        embedUrl: `https://v.turkvearab.com/embed-${serverId}.html`,
        fetchReferer: "https://qesen.net/",
        streamReferer: "https://v.turkvearab.com/",
      };
    case "estream":
      return {
        embedUrl: `https://arabveturk.com/embed-${serverId}.html`,
        fetchReferer: "https://qesen.net/",
        streamReferer: "https://arabveturk.com/",
      };
    default:
      return null;
  }
}

async function getQStreams(episodeUrl, bingeGroup) {
  const cacheKey = episodeUrl;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STREAM_TTL) return cached.streams;

  const playerData = await extractPlayerData(episodeUrl);
  const streams = [];

  if (playerData) {
    const supportedServers = playerData.servers.filter((s) =>
      ["arab hd", "estream"].includes(s.name.toLowerCase())
    );

    const results = await Promise.allSettled(
      supportedServers.map(async (server) => {
        const info = buildEmbedInfo(server.name, server.id);
        if (!info) return null;

        const m3u8Url = await extractM3u8FromEmbed(info.embedUrl, info.fetchReferer);
        if (!m3u8Url) return null;

        return {
          serverName: server.name,
          m3u8Url,
          streamReferer: info.streamReferer,
        };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const { serverName, m3u8Url, streamReferer } = result.value;
        const emoji = serverName.toLowerCase() === "arab hd" ? "🎬" : "📺";
        streams.push({
          name: "قصة عشق",
          title: `${emoji} ${serverName}`,
          url: m3u8Url,
          behaviorHints: {
            notWebReady: false,
            bingeGroup,
            headers: {
              Referer: streamReferer,
              Origin: new URL(streamReferer).origin,
            },
          },
        });
      }
    }

    streams.push({
      name: "قصة عشق",
      title: "🌐 شاهد في المتصفح (qesen.net)",
      externalUrl: playerData.watchUrl,
      behaviorHints: { notWebReady: false },
    });
  } else {
    streams.push({
      name: "قصة عشق",
      title: "🌐 شاهد في المتصفح",
      externalUrl: episodeUrl,
      behaviorHints: { notWebReady: false },
    });
  }

  streamCache.set(cacheKey, { streams, ts: Date.now() });
  return streams;
}

// ─── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());

app.get("/manifest.json", (_req, res) => res.json(MANIFEST));

app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id: catalogId } = req.params;
  try {
    const items = await getCatalogItems(catalogId);
    const metas = items
      .filter((i) => i.type === type)
      .map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        poster: i.poster,
        posterShape: "poster",
      }));
    res.json({ metas });
  } catch (err) {
    console.error("catalog error", err.message);
    res.json({ metas: [] });
  }
});

app.get("/meta/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  const withoutPrefix = id.replace(/^qeseh:/, "");
  const colonIdx = withoutPrefix.indexOf(":");
  if (colonIdx === -1) return res.status(400).json({ meta: null });

  const contentType = withoutPrefix.slice(0, colonIdx);
  const slug = decodeSlug(withoutPrefix.slice(colonIdx + 1));

  try {
    const meta = await getMeta(contentType, slug);
    if (!meta) return res.status(404).json({ meta: null });

    const stremioType = contentType === "movie" ? "movie" : "series";
    const videos = meta.episodes.map((ep) => ({
      id: ep.id,
      title: ep.title,
      season: ep.season,
      episode: ep.episode,
      released: new Date(
        Date.now() - ep.episode * 24 * 60 * 60 * 1000
      ).toISOString(),
      overview: "",
    }));

    res.json({
      meta: {
        id: meta.id,
        type: stremioType,
        name: meta.name,
        poster: meta.poster,
        background: meta.poster,
        description: meta.description || "",
        videos: stremioType === "series" ? videos : undefined,
      },
    });
  } catch (err) {
    console.error("meta error", err.message);
    res.status(500).json({ meta: null });
  }
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  const withoutPrefix = id.replace(/^qeseh:/, "");
  const parts = withoutPrefix.split(":");
  if (parts.length < 2) return res.json({ streams: [] });

  const contentType = parts[0];
  const slug1 = decodeSlug(parts[1] || "");
  const slug2 = decodeSlug(parts[2] || "");

  try {
    let episodeUrl;
    let bingeGroup;

    if (contentType === "movie") {
      episodeUrl = `${BASE}/movies/${slug1}/`;
      bingeGroup = `qeseh-${slug1}`;
    } else if (slug2 && slug2 !== "play") {
      episodeUrl = `${BASE}/clarus/${slug2}/`;
      bingeGroup = `qeseh-${slug1}`;
    } else if (contentType === "ep-series") {
      episodeUrl = `${BASE}/clarus/${slug1}/`;
      bingeGroup = `qeseh-${slug1.replace(/-episode-\d+$/, "")}`;
    } else {
      const meta = await getMeta("series", slug1);
      if (!meta?.episodes.length) return res.json({ streams: [] });
      episodeUrl = meta.episodes[0].episodeUrl;
      bingeGroup = `qeseh-${slug1}`;
    }

    const streams = await getQStreams(episodeUrl, bingeGroup);
    res.json({ streams });
  } catch (err) {
    console.error("stream error", err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () =>
  console.log(
    `Qeseh Stremio Addon v1.1.0 running on port ${PORT}\nManifest: http://localhost:${PORT}/manifest.json`
  )
);

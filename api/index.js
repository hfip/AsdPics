const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = "https://asd.pics";

// ─── نظام الذاكرة المؤقتة (Cache) لتجنب الحظر وتسريع الاستجابة ───
const pageCache = new Map();
const PAGE_TTL = 5 * 60 * 1000; // 5 دقائق

async function fetchHtml(url) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.3",
        "Referer": BASE_URL,
      },
      timeout: 8000
    });
    const html = await res.text();
    pageCache.set(url, { html, ts: Date.now() });
    return html;
  } catch (err) {
    console.error("[-] خطأ أثناء جلب الصفحة المحددة:", err);
    return null;
  }
}

// ─── 1. تعريف الـ Manifest (هوية الإضافة في ستريمو) ───
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.asdpics.addon",
    version: "1.0.0",
    name: "Asd Pics (عرب سيد)",
    description: "إضافة لمتابعة وسحب الأفلام والمسلسلات والكتالوجات من موقع Asd Pics وعرب سيد مباشرة",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"], // لربط الإضافة ببيانات IMDB للبحث التلقائي
    catalogs: [
      {
        id: "asd_arabic_movies",
        type: "movie",
        name: "Asd Pics - أفلام عربية",
        extra: [{ name: "search", isRequired: false }]
      },
      {
        id: "asd_arabic_series",
        type: "series",
        name: "Asd Pics - مسلسلات عربية",
        extra: [{ name: "search", isRequired: false }]
      }
    ],
    background: "https://asd.pics/templates/Default/images/logo.png",
    logo: "https://asd.pics/templates/Default/images/logo.png",
  });
});

// ─── 2. معالج الكاتالوجات (Catalog Handler) ───
app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  const { type } = req.params;
  const extra = req.params.extra ? Object.fromEntries(new URLSearchParams(req.params.extra)) : {};
  const searchQuery = extra.search;

  let targetUrl = `${BASE_URL}/home7/`;

  if (searchQuery) {
    targetUrl = `${BASE_URL}/home7/?story=${encodeURIComponent(searchQuery)}&do=search&subaction=search`;
  }

  try {
    const html = await fetchHtml(targetUrl);
    if (!html) return res.json({ metas: [] });

    const $ = load(html);
    const metas = [];

    $(".card, .post, .shortstory, a").each((_i, el) => {
      const title = $(el).find(".card__title, .post-title, h2").text().trim() || $(el).text().trim();
      const href = $(el).attr("href") || $(el).find("a").attr("href");
      let poster = $(el).find("img").attr("src") || $(el).find("img").attr("data-src");

      if (href && title && (href.includes("/movies/") || href.includes("/series/") || href.includes("home7"))) {
        if (poster && poster.startsWith("/")) poster = `${BASE_URL}${poster}`;
        
        const slug = href.replace(BASE_URL, "").replace(/\//g, "_");

        metas.push({
          id: `asd:${type}:${slug}`,
          type: type,
          name: title,
          poster: poster || "https://asd.pics/templates/Default/images/logo.png",
          background: poster || "https://asd.pics/templates/Default/images/logo.png",
        });
      }
    });

    const uniqueMetas = metas.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
    res.json({ metas: uniqueMetas });
  } catch (err) {
    console.error("[-] خطأ في معالجة الكاتالوج:", err);
    res.json({ metas: [] });
  }
});

// ─── 3. معالج الميتا (Meta Handler) ───
app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  
  if (!id.startsWith("asd:")) {
    return res.json({ meta: null });
  }

  const slug = id.split(":")[2].replace(/_/g, "/");
  const targetUrl = `${BASE_URL}${slug}`;

  try {
    const html = await fetchHtml(targetUrl);
    if (!html) return res.json({ meta: null });

    const $ = load(html);
    const title = $(".post-title, h1, title").text().trim();
    let poster = $(".post-poster img, .poster img").attr("src");
    if (poster && poster.startsWith("/")) poster = `${BASE_URL}${poster}`;

    const videos = [];

    if (type === "series") {
      $("a").each((i, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr("href");

        if (href && (text.includes("الحلقة") || text.includes("حلقة"))) {
          const epSlug = href.replace(BASE_URL, "").replace(/\//g, "_");
          videos.push({
            id: `asd:series:${epSlug}`,
            title: text,
            season: 1,
            episode: i + 1,
            released: new Date().toISOString(),
          });
        }
      });
    }

    res.json({
      meta: {
        id,
        type,
        name: title,
        poster: poster || "https://asd.pics/templates/Default/images/logo.png",
        background: poster || "https://asd.pics/templates/Default/images/logo.png",
        description: "مشاهدة مباشرة بجودة عالية عبر سيرفرات متعددة.",
        videos: type === "series" ? videos : undefined,
      },
    });
  } catch (err) {
    console.error("[-] خطأ في جلب بيانات الميتا:", err);
    res.status(500).json({ meta: null });
  }
});

// ─── 4. معالج البث المباشر (Stream Handler) ───
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;

  let targetUrl = "";

  if (id.startsWith("asd:")) {
    const slug = id.split(":")[2].replace(/_/g, "/");
    targetUrl = `${BASE_URL}${slug}`;
  } else {
    const parts = id.split(":");
    const imdbId = parts[0];
    const mediaName = await getArabicNameFromTMDB(imdbId, type);
    
    if (mediaName) {
      targetUrl = `${BASE_URL}/home7/?story=${encodeURIComponent(mediaName)}&do=search&subaction=search`;
    }
  }

  if (!targetUrl) return res.json({ streams: [] });

  try {
    const html = await fetchHtml(targetUrl);
    if (!html) return res.json({ streams: [] });

    const $ = load(html);
    const streams = [];

    $("iframe, a, source, video, button").each((_i, el) => {
      let src = $(el).attr("src") || $(el).attr("href") || $(el).attr("data-src") || $(el).attr("data-link");

      if (src) {
        if (src.startsWith("//")) src = `https:${src}`;
        if (src.startsWith("/")) src = `${BASE_URL}${src}`;

        if (
          src.includes(".m3u8") || 
          src.includes(".mp4") || 
          src.includes("boutique") || 
          src.includes("tnmr.org") || 
          src.includes("vmwesa.online") || 
          src.includes("r66nv9ed.com")
        ) {
          const isHls = src.includes("m3u8");
          streams.push({
            title: `🎬 Asd Pics - جودة متعددة (${isHls ? "HLS/M3U8" : "MP4 المباشر"})`,
            url: src,
            behaviorHints: {
              notWebReady: isHls,
              referer: targetUrl
            }
          });
        }
      }
    });

    res.json({ streams });
  } catch (err) {
    console.error("[-] خطأ أثناء توليد مسارات البث:", err);
    res.status(500).json({ streams: [] });
  }
});

async function getArabicNameFromTMDB(imdbId, type) {
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=f090bb54758cabaf2312cdbf31fa6e55&external_source=imdb_id&language=ar`;
    
    const res = await fetch(tmdbUrl);
    const data = await res.json();
    
    const results = data.movie_results || data.tv_results;
    if (results && results.length > 0) {
      return results[0].title || results[0].name;
    }
  } catch (e) {
    console.error("[-] فشل جلب الاسم العربي من TMDB:", e);
  }
  return null;
}

app.listen(PORT, () => {
  console.log(`[+] Addon is active and running on port ${PORT}`);
});

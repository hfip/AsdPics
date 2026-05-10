const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

// حل توافقية node-fetch في بيئة Serverless على Vercel
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const BASE_URL = "https://asd.pics";
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

const pageCache = new Map();
const PAGE_TTL = 5 * 60 * 1000;

async function fetchHtml(url) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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
    console.error("[-] خطأ أثناء جلب الصفحة:", err.message);
    return null;
  }
}

// دالة فك تشفير Base64 بدقة وبدون أخطاء
function decodeBase64(str) {
  try {
    // تنظيف النص المشفر من أي فراغات أو رموز زائدة
    const cleanStr = str.trim().replace(/[^A-Za-z0-9+/=]/g, "");
    return Buffer.from(cleanStr, 'base64').toString('utf-8');
  } catch (e) {
    return null;
  }
}

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.2.5",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة متطورة لسحب البث والروابط وفك تشفير السيرفرات تلقائياً من موقع Asd Pics وعرب سيد",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// جلب الاسم العربي من TMDB
async function getTmdbMeta(imdbId, type) {
  try {
    const tmdbType = type === "movie" ? "movie" : "tv";
    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`;
    const res = await fetch(findUrl);
    const data = await res.json();
    
    const result = (data.movie_results && data.movie_results[0]) || (data.tv_results && data.tv_results[0]);
    if (!result) return null;
    
    const detailsUrl = `https://api.themoviedb.org/3/${tmdbType}/${result.id}?api_key=${TMDB_KEY}&language=ar-SA`;
    const detailsRes = await fetch(detailsUrl);
    const arData = await detailsRes.json();
    
    const title = arData.name || arData.title || result.name || result.title || "";
    return { arabicTitle: title.trim() };
  } catch (e) {
    console.error("[-] فشل جلب الاسم العربي من TMDB:", e.message);
    return null;
  }
}

// البحث الذكي داخل الموقع
async function searchAsdPics(arabicTitle, type, episode) {
  if (!arabicTitle) return null;
  
  const cleanTitle = arabicTitle.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const searchUrl = `${BASE_URL}/home7/?story=${encodeURIComponent(cleanTitle)}&do=search&subaction=search`;
  
  console.log(`[AsdPics] Searching with URL: ${searchUrl}`);
  const html = await fetchHtml(searchUrl);
  if (!html) return null;

  const $ = load(html);
  const candidates = [];

  $("a").each((_i, el) => {
    const href = $(el).attr("href");
    if (href && (href.includes("/movies/") || href.includes("/series/") || href.includes("/home7/"))) {
      if (!candidates.includes(href)) {
        candidates.push(href);
      }
    }
  });

  if (candidates.length === 0) return null;
  let matchedUrl = candidates[0];

  // إذا كان مسلسلاً، نتوجه للحلقة المحددة
  if (type === "series" && episode && matchedUrl) {
    const pageHtml = await fetchHtml(matchedUrl);
    if (pageHtml) {
      const $page = load(pageHtml);
      $page("a").each((_i, el) => {
        const epUrl = $page(el).attr("href");
        const epText = $page(el).text().trim();
        if (epUrl && (epText.includes(`الحلقة ${episode}`) || epText.includes(`الحلقة-${episode}`) || epUrl.includes(`-الحلقة-${episode}`))) {
          matchedUrl = epUrl;
          return false;
        }
      });
    }
  }

  return matchedUrl;
}

// استخراج وفك تشفير البث المباشر بدقة كاملة
async function extractStreams(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return [];

  const $ = load(html);
  const streams = [];
  const seen = new Set();

  // 1. البحث أولاً عن كل الروابط وسمات src و data-link و iframes في الصفحة
  $("iframe, a, source, video, button, div, script").each((_i, el) => {
    let src = $(el).attr("src") || $(el).attr("href") || $(el).attr("data-src") || $(el).attr("data-link") || $(el).attr("data-file") || "";

    if (src) {
      if (src.startsWith("//")) src = `https:${src}`;

      let decodedUrl = src;

      // أ) التحقق مما إذا كان الرابط يحتوي على تشفير Base64 صريح (مثل play.php?url=)
      if (src.includes("play.php?url=")) {
        const base64Part = src.split("play.php?url=")[1];
        const decoded = decodeBase64(base64Part);
        if (decoded) decodedUrl = decoded;
      }
      
      // ب) التحقق مما إذا كانت القيمة الممررة مشفرة بالكامل بـ Base64 (تبدأ بـ aHR0cHM6Ly9)
      else if (src.trim().startsWith("aHR0cHM6Ly")) {
        const decoded = decodeBase64(src);
        if (decoded) decodedUrl = decoded;
      }

      // 2. التحقق من تطابق الرابط (بعد فك التشفير) مع سيرفرات البث والمشاهدة النشطة
      if (
        decodedUrl.includes(".m3u8") || 
        decodedUrl.includes(".mp4") || 
        decodedUrl.includes("boutique") || 
        decodedUrl.includes("tnmr.org") || 
        decodedUrl.includes("vmwesa.online") || 
        decodedUrl.includes("r66nv9ed.com") ||
        decodedUrl.includes("reviewrate.net") ||
        decodedUrl.includes("reviewrate")
      ) {
        if (!seen.has(decodedUrl)) {
          seen.add(decodedUrl);
          const isHls = decodedUrl.includes(".m3u8");
          const isReview = decodedUrl.includes("reviewrate");
          const serverLabel = isReview ? "سيرفر خاص سريع" : (isHls ? "HLS/M3U8" : "MP4 المباشر");

          streams.push({
            url: decodedUrl,
            title: `سيرفر ${serverLabel}`
          });
        }
      }
    }
  });

  return streams;
}

async function getAsdPicsStreams(imdbId, type, season, episode) {
  const meta = await getTmdbMeta(imdbId, type);
  if (!meta || !meta.arabicTitle) {
    console.log("[AsdPics] No Arabic title found for ID: " + imdbId);
    return [];
  }

  console.log("[AsdPics] Found title: " + meta.arabicTitle + " (E" + episode + ")");

  const pageUrl = await searchAsdPics(meta.arabicTitle, type, episode);
  if (!pageUrl) {
    console.log("[AsdPics] Target Page not found");
    return [];
  }

  console.log("[AsdPics] Scraped Page URL: " + pageUrl);
  const rawStreams = await extractStreams(pageUrl);

  return rawStreams.map(s => ({
    name: "Asd Pics by Abdulluh.X",
    title: `🎬 ${s.title} | جودة متعددة`,
    url: s.url,
    behaviorHints: {
      notWebReady: false,
      headers: { "Referer": BASE_URL + "/" }
    }
  }));
}

// معالجة منافذ المسارات
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get("/", (req, res) => {
  res.json(manifest);
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const parts = id.split(":");
  const imdbId = parts[0];
  const season = parseInt(parts[1] || "1");
  const episode = parseInt(parts[2] || "1");

  console.log("[AsdPics] Processing stream: " + imdbId + " S" + season + "E" + episode);

  try {
    const streams = await getAsdPicsStreams(imdbId, type, season, episode);
    console.log("[AsdPics] Found successfully: " + streams.length + " streams");
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Stream process error: " + e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

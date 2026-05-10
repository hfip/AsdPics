const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

// حل توافقية node-fetch مع Vercel Serverless
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const BASE_URL = "https://asd.pics";
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

const pageCache = new Map();
const PAGE_TTL = 3 * 60 * 1000; // تقليص الكاش لضمان تحديث الروابط المؤقتة سريعا

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
    console.error("[-] خطأ أثناء جلب الصفحة:", err.message);
    return null;
  }
}

// دالة فك تشفير Base64 بدقة فائقة
function decodeBase64(str) {
  try {
    const cleanStr = str.trim().replace(/[^A-Za-z0-9+/=]/g, "");
    return Buffer.from(cleanStr, 'base64').toString('utf-8');
  } catch (e) {
    return null;
  }
}

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.3.0",
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

  // التوجيه لصفحة الحلقة للمسلسلات
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

// استخراج وفك تشفير البث المباشر من كامل الكود الخام للصفحة
async function extractStreams(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  // 1. البحث باستخدام الـ Regex عن روابط play.php?url= المخفية في كامل كود الصفحة (HTML الخام)
  const base64PlayPattern = /play\.php\?url=([A-Za-z0-9+/=]+)/gi;
  let match;
  while ((match = base64PlayPattern.exec(html)) !== null) {
    const decoded = decodeBase64(match[1]);
    if (decoded && !seen.has(decoded)) {
      seen.add(decoded);
      const isHls = decoded.includes(".m3u8");
      streams.push({
        url: decoded,
        title: `سيرفر خاص سريع (${isHls ? "HLS/M3U8" : "MP4"})`
      });
    }
  }

  // 2. البحث عن أي نصوص مشفرة بالكامل بـ Base64 تبدأ بترميز الرابط الشهير (aHR0cHM6Ly) في الصفحة
  const rawBase64Pattern = /(aHR0cHM6Ly[A-Za-z0-9+/=]+)/gi;
  let rawMatch;
  while ((rawMatch = rawBase64Pattern.exec(html)) !== null) {
    const decoded = decodeBase64(rawMatch[1]);
    if (decoded && (decoded.includes("m3u8") || decoded.includes("mp4") || decoded.includes("reviewrate") || decoded.includes("boutique"))) {
      if (!seen.has(decoded)) {
        seen.add(decoded);
        const isHls = decoded.includes(".m3u8");
        streams.push({
          url: decoded,
          title: `سيرفر مدمج ملقط (${isHls ? "HLS/M3U8" : "MP4"})`
        });
      }
    }
  }

  // 3. مسح كلاسيكي احتياطي للروابط والمشغلات الظاهرة
  const $ = load(html);
  $("iframe, a, source, video, button").each((_i, el) => {
    let src = $(el).attr("src") || $(el).attr("href") || $(el).attr("data-src") || $(el).attr("data-link") || "";
    if (src.startsWith("//")) src = `https:${src}`;
    if (src.startsWith("/")) src = `${BASE_URL}${src}`;

    if (
      src.includes(".m3u8") || 
      src.includes(".mp4") || 
      src.includes("boutique") || 
      src.includes("tnmr.org") || 
      src.includes("vmwesa.online") || 
      src.includes("r66nv9ed.com") ||
      src.includes("reviewrate")
    ) {
      if (!seen.has(src)) {
        seen.add(src);
        const isHls = src.includes(".m3u8");
        streams.push({
          url: src,
          title: `سيرفر احتياطي (${isHls ? "HLS" : "MP4"})`
        });
      }
    }
  });

  return streams;
}

async function getAsdPicsStreams(imdbId, type, season, episode) {
  const meta = await getTmdbMeta(imdbId, type);
  if (!meta || !meta.arabicTitle) {
    console.log("[AsdPics] No Arabic title found for: " + imdbId);
    return [];
  }

  console.log("[AsdPics] Fetching title: " + meta.arabicTitle + " (E" + episode + ")");

  const pageUrl = await searchAsdPics(meta.arabicTitle, type, episode);
  if (!pageUrl) {
    console.log("[AsdPics] Page not found");
    return [];
  }

  console.log("[AsdPics] Found Page URL: " + pageUrl);
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

// التوجيهات
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

  console.log("[AsdPics] Stream Request for: " + imdbId + " S" + season + "E" + episode);

  try {
    const streams = await getAsdPicsStreams(imdbId, type, season, episode);
    console.log("[AsdPics] Streams count returned: " + streams.length);
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Error: " + e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

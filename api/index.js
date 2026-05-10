const https = require("https");
const http = require("http");

const BASE_URL = "https://asd.pics";
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "ar,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": "https://asd.pics/"
};

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.1.0",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة لسحب البث والروابط من موقع Asd Pics ومصادر عرب سيد مباشرة",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

function fetchText(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => resolve(""), 8000);
    try {
      const req = client.get(url, { headers: HEADERS }, (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks).toString("utf-8"));
        });
      });
      req.on("error", () => { clearTimeout(timer); resolve(""); });
    } catch (e) { clearTimeout(timer); resolve(""); }
  });
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => resolve({}), 8000);
    try {
      const req = client.get(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
        });
      });
      req.on("error", () => { clearTimeout(timer); resolve({}); });
    } catch (e) { clearTimeout(timer); resolve({}); }
  });
}

// جلب الاسم العربي للفيلم أو المسلسل من TMDB
async function getTmdbMeta(imdbId, type) {
  const tmdbType = type === "movie" ? "movie" : "tv";
  const data = await fetchJson(
    "https://api.themoviedb.org/3/find/" + imdbId +
    "?api_key=" + TMDB_KEY + "&external_source=imdb_id"
  );
  
  const result = (data.movie_results && data.movie_results[0]) || (data.tv_results && data.tv_results[0]);
  if (!result) return null;
  
  const tmdbId = result.id;
  const arData = await fetchJson(
    "https://api.themoviedb.org/3/" + tmdbType + "/" + tmdbId +
    "?api_key=" + TMDB_KEY + "&language=ar-SA"
  );
  
  return {
    arabicTitle: arData.name || arData.title || result.name || result.title || ""
  };
}

// دالة محسنة للبحث ومطابقة النتائج داخل Asd Pics
async function searchAsdPics(arabicTitle, type, episode) {
  if (!arabicTitle) return null;
  
  // تنظيف النص لضمان تطابق أفضل في البحث داخل الموقع
  const cleanTitle = arabicTitle.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, "").trim();
  const searchUrl = BASE_URL + "/home7/?story=" + encodeURIComponent(cleanTitle) + "&do=search&subaction=search";
  const html = await fetchText(searchUrl);
  if (!html) return null;

  const linkPattern = /href="(https?:\/\/asd\.pics\/[^"]+)"/gi;
  let m;
  const candidates = [];

  while ((m = linkPattern.exec(html)) !== null) {
    const url = m[1];
    const decoded = decodeURIComponent(url);
    // تصفية الروابط لاستخراج مسارات الأفلام والمسلسلات الحقيقية فقط واستبعاد الروابط الجانبية
    if (decoded.includes("/movies/") || decoded.includes("/series/") || decoded.includes("/home7/")) {
      if (!candidates.includes(url)) {
        candidates.push(url);
      }
    }
  }

  if (candidates.length === 0) return null;

  let matchedUrl = candidates[0];

  // إذا كان مسلسل، نبحث داخل الصفحة الأساسية عن رابط الحلقة المحددة
  if (type === "series" && episode && matchedUrl) {
    const pageHtml = await fetchText(matchedUrl);
    if (pageHtml) {
      const epPattern = /href="(https?:\/\/asd\.pics\/[^"]+)"/gi;
      let epMatch;
      while ((epMatch = epPattern.exec(pageHtml)) !== null) {
        const epUrl = epMatch[1];
        const decodedEp = decodeURIComponent(epUrl);
        // التحقق من رقم الحلقة بصيغ متعددة
        if (
          decodedEp.includes("الحلقة-" + episode + "-") || 
          decodedEp.includes("الحلقة-" + episode + "/") ||
          decodedEp.endsWith("الحلقة-" + episode) ||
          decodedEp.includes("الحلقة " + episode)
        ) {
          matchedUrl = epUrl;
          break;
        }
      }
    }
  }

  return matchedUrl;
}

// استخراج مصادر البث والمشغلات مع دعم السيرفرات الخارجية النشطة
async function extractStreams(pageUrl) {
  const html = await fetchText(pageUrl);
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  const videoPatterns = [
    /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*boutique[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*tnmr\.org[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*vmwesa\.online[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*r66nv9ed\.com[^\s"'<>]*)/gi
  ];

  for (const pattern of videoPatterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      let url = m[1];
      if (url.endsWith(")") || url.endsWith("'") || url.endsWith('"')) {
        url = url.slice(0, -1);
      }
      if (!seen.has(url)) {
        seen.add(url);
        const isHls = url.includes(".m3u8");
        streams.push({
          url: url,
          title: `سيرفر خاص (${isHls ? "HLS/M3U8" : "MP4"})`
        });
      }
    }
  }

  // فحص الـ iframes المدمجة (سيرفرات المشاهدة السريعة)
  const iframePattern = /<iframe[^>]*src=["'](https?:\/\/[^"']+)["']/gi;
  let iframeMatch;
  while ((iframeMatch = iframePattern.exec(html)) !== null) {
    const src = iframeMatch[1];
    if (seen.has(src)) continue;
    if (["google", "facebook", "ads", "gravatar"].some(x => src.includes(x))) continue;
    seen.add(src);

    const embedHtml = await fetchText(src);
    if (embedHtml) {
      for (const pattern of videoPatterns) {
        let embedVideo;
        while ((embedVideo = pattern.exec(embedHtml)) !== null) {
          const url = embedVideo[1];
          if (!seen.has(url)) {
            seen.add(url);
            const isHls = url.includes(".m3u8");
            streams.push({ 
              url: url, 
              title: `سيرفر مدمج (${isHls ? "HLS/M3U8" : "MP4"})` 
            });
          }
        }
      }
    }
  }

  return streams;
}

async function getAsdPicsStreams(imdbId, type, season, episode) {
  const meta = await getTmdbMeta(imdbId, type);
  if (!meta || !meta.arabicTitle) {
    console.log("[AsdPics] No Arabic title for: " + imdbId);
    return [];
  }

  console.log("[AsdPics] Searching for: " + meta.arabicTitle + " (E" + episode + ")");

  const pageUrl = await searchAsdPics(meta.arabicTitle, type, episode);
  if (!pageUrl) {
    console.log("[AsdPics] Content page not found");
    return [];
  }

  console.log("[AsdPics] Found Page URL: " + pageUrl);

  const rawStreams = await extractStreams(pageUrl);
  if (rawStreams.length === 0) {
    console.log("[AsdPics] No valid streams extracted");
    return [];
  }

  return rawStreams.map(s => ({
    name: "Asd Pics by Abdulluh.X",
    title: s.title + " | جودة متعددة 🌐",
    url: s.url,
    behaviorHints: {
      notWebReady: false,
      headers: { "Referer": BASE_URL + "/" }
    }
  }));
}

module.exports = async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");

  const url = req.url || "/";

  if (url === "/" || url.includes("/manifest.json")) {
    return res.end(JSON.stringify(manifest));
  }

  const streamMatch = url.match(/\/stream\/(series|movie)\/(.+)\.json/);
  if (streamMatch) {
    try {
      const type = streamMatch[1];
      const fullId = streamMatch[2];
      const parts = fullId.split(":");
      const imdbId = parts[0];
      const season = parseInt(parts[1] || "1");
      const episode = parseInt(parts[2] || "1");

      console.log("[AsdPics] Handling request for ID: " + imdbId);
      const streams = await getAsdPicsStreams(imdbId, type, season, episode);
      console.log("[AsdPics] Total streams found: " + streams.length);
      return res.end(JSON.stringify({ streams }));
    } catch (e) {
      console.error("[AsdPics] Server Error: " + e.message);
      return res.end(JSON.stringify({ streams: [] }));
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
};

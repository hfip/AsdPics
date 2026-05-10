const https = require("https");
const http = require("http");

const BASE_URL = "https://asd.pics";
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Accept-Language": "ar,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": "https://asd.pics/"
};

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.1.0",
  name: "Asd Pics | عرب سيد",
  description: "إضافة لسحب البث والكتالوجات من موقع Asd Pics ومصادر عرب سيد",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// دالة مدمجة لجلب الـ HTML بدون استخدام node-fetch لمنع تعارضات النشر
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

// دالة مدمجة لجلب الـ JSON
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

// دالة جلب الاسم العربي للفيلم أو المسلسل من قاعدة بيانات TMDB
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

// البحث في الموقع عن المقال الخاص بالمادة
async function searchAsdPics(arabicTitle, type, episode) {
  const searchUrl = BASE_URL + "/home7/?story=" + encodeURIComponent(arabicTitle) + "&do=search&subaction=search";
  const html = await fetchText(searchUrl);
  if (!html) return null;

  const linkPattern = /href="(https?:\/\/asd\.pics\/[^"]+)"/gi;
  let m;
  const candidates = [];

  while ((m = linkPattern.exec(html)) !== null) {
    const url = m[1];
    const decoded = decodeURIComponent(url);
    if (decoded.includes("movies") || decoded.includes("series") || decoded.includes("home7")) {
      candidates.push(url);
    }
  }

  if (candidates.length === 0) return null;

  let matchedUrl = candidates[0];

  // إذا كان المطلوب مسلسل، نحاول جلب صفحة الحلقة مباشرة
  if (type === "series" && episode && matchedUrl) {
    const pageHtml = await fetchText(matchedUrl);
    if (pageHtml) {
      const epPattern = /href="(https?:\/\/asd\.pics\/[^"]+)"/gi;
      let epMatch;
      while ((epMatch = epPattern.exec(pageHtml)) !== null) {
        const epUrl = epMatch[1];
        const decodedEp = decodeURIComponent(epUrl);
        if (decodedEp.includes("الحلقة-" + episode) || decodedEp.includes("الحلقة " + episode)) {
          matchedUrl = epUrl;
          break;
        }
      }
    }
  }

  return matchedUrl;
}

// استخراج مصادر البث (m3u8 أو mp4) من داخل صفحة المشاهدة
async function extractStreams(pageUrl) {
  const html = await fetchText(pageUrl);
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  // مصفوفة تعابير لتحديد روابط الفيديو المباشرة والمشغلات المعروفة
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
      // تنظيف الرابط إذا لزم الأمر
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

  // التقاط مشغلات الـ Iframe المدمجة والبحث بداخلها
  const iframePattern = /iframe[^>]*src=["'](https?:\/\/[^\"']+)["']/gi;
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
            streams.push({ url: url, title: "سيرفر مدمج" });
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

  console.log("[AsdPics] Title: " + meta.arabicTitle + " E" + episode);

  const pageUrl = await searchAsdPics(meta.arabicTitle, type, episode);
  if (!pageUrl) {
    console.log("[AsdPics] Content not found on site");
    return [];
  }

  console.log("[AsdPics] Page: " + pageUrl);

  const rawStreams = await extractStreams(pageUrl);
  if (rawStreams.length === 0) {
    console.log("[AsdPics] No streams found");
    return [];
  }

  return rawStreams.map(s => ({
    name: "Asd Pics by Abdulluh.X",
    title: s.title + " | جودة متعددة",
    url: s.url,
    behaviorHints: {
      notWebReady: false,
      headers: { "Referer": BASE_URL + "/" }
    }
  }));
}

// دالة التصدير الرئيسية المتوافقة مع Vercel Serverless Functions بنسبة 100%
module.exports = async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

      console.log("[AsdPics] " + imdbId + " S" + season + "E" + episode);
      const streams = await getAsdPicsStreams(imdbId, type, season, episode);
      console.log("[AsdPics] Found " + streams.length + " streams");
      return res.end(JSON.stringify({ streams }));
    } catch (e) {
      console.error("[AsdPics] Error: " + e.message);
      return res.end(JSON.stringify({ streams: [] }));
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
};

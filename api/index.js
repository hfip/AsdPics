const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const BASE_URL = "https://asd.pics";
const WATCH_BASE = "https://m.reviewrate.net";
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

// هيدرز قياسية لمنع الحجب ومحاكاة الطلبات الحقيقية
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "ar,en-US;q=0.7,en;q=0.3"
};

const pageCache = new Map();
const PAGE_TTL = 3 * 60 * 1000;

async function fetchHtml(url, referer = BASE_URL) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;

  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        "Referer": referer,
      },
      timeout: 8000
    });
    const html = await res.text();
    pageCache.set(url, { html, ts: Date.now() });
    return html;
  } catch (err) {
    console.error("[-] Error fetching HTML:", err.message);
    return null;
  }
}

// دالة إرسال طلب POST بصيغة x-www-form-urlencoded لمحاكاة الـ Ajax الخاص بعرب سيد
async function postAjax(url, data, referer) {
  try {
    const formBody = Object.keys(data)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
      .join('&');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": HEADERS["User-Agent"],
        "Referer": referer,
        "Origin": WATCH_BASE
      },
      body: formBody,
      timeout: 8000
    });
    return await res.text();
  } catch (err) {
    console.error("[-] Error in POST request:", err.message);
    return null;
  }
}

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.9.5",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة متطورة لسحب البث المباشر (m3u8 و mp4) من سيرفرات عرب سيد والمشغل الرئيسي مباشرة",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// جلب الاسم العربي من TMDB لضمان التوجيه الصحيح
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
    return null;
  }
}

// البحث عن الصفحة المطلوبة في الموقع
async function searchAsdPics(arabicTitle, type, episode) {
  if (!arabicTitle) return null;
  
  const cleanTitle = arabicTitle.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const searchUrl = `${BASE_URL}/home7/?story=${encodeURIComponent(cleanTitle)}&do=search&subaction=search`;
  
  console.log(`[AsdPics] Searching URL: ${searchUrl}`);
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

// استخراج السيرفرات بناءً على منطق طلب الـ POST المزدوج لـ GameHub Extractor
async function extractStreams(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  // 1. استخراج الـ csrf_token والـ post_id من الصفحة الأساسية
  const csrfTokenMatch = html.match(/['" ]csrf_token['" ]\s*:\s*['"]([^'"]+)['"]/);
  const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;

  let postId = null;
  const postIdMatch = html.match(/['" ]post_id['" ]\s*:\s*['" ]?(\d+)['" ]?/i) || html.match(/data-post=["'](\d+)["']/i);
  if (postIdMatch) {
    postId = postIdMatch[1];
  }

  console.log(`[AsdPics] Post ID: ${postId} | CSRF Token: ${csrfToken}`);

  // 2. محاكاة طلبات POST المتتابعة للحصول على السيرفرات ومصادر الفيديو
  if (csrfToken && postId) {
    const ajaxUrl = `${BASE_URL}/get__watch__server/`;

    // طلب الـ POST الأول: جلب قائمة السيرفرات المتوفرة (التي تعود بكود HTML يحتوي على خيارات data-server)
    const listServersData = {
      "post_id": postId,
      "csrf_token": csrfToken
    };

    console.log(`[AsdPics] Requesting server list (POST 1)...`);
    const listHtml = await postAjax(ajaxUrl, listServersData, pageUrl);

    if (listHtml) {
      const $list = load(listHtml);
      const serverElements = [];

      // قراءة معرف السيرفرات والجودات المتاحة من استجابة عرب سيد
      $list("li[data-server]").each((_i, el) => {
        const serverId = $list(el).attr("data-server");
        const quality = $list(el).attr("data-quality") || "1080";
        if (serverId) {
          serverElements.push({ id: serverId, quality: quality });
        }
      });

      console.log(`[AsdPics] Found (${serverElements.length}) servers inside list`);

      // طلب الـ POST الثاني لكل سيرفر: جلب الرابط الحقيقي للـ iframe ومطابقتها مع السيرفرات التي حددتها بالفيديو
      for (const server of serverElements) {
        const serverDetailsData = {
          "post_id": postId,
          "quality": server.quality,
          "server": server.id,
          "csrf_token": csrfToken
        };

        const serverResponse = await postAjax(ajaxUrl, serverDetailsData, pageUrl);

        if (serverResponse) {
          let iframeUrl = "";
          try {
            // محاولة قراءة الاستجابة كـ JSON
            const parsed = JSON.parse(serverResponse);
            iframeUrl = parsed.server || "";
          } catch (e) {
            // محاولة جلب رابط الـ iframe عبر الـ Regex إذا كانت استجابة خام
            const iframeMatch = serverResponse.match(/src=["'](https?:\/\/[^"']+)["']/i);
            if (iframeMatch) iframeUrl = iframeMatch[1];
          }

          if (iframeUrl.startsWith("//")) iframeUrl = `https:${iframeUrl}`;

          if (iframeUrl && !seen.has(iframeUrl)) {
            seen.add(iframeUrl);

            // جلب روابط البث المباشرة من داخل صفحة الـ Iframe نفسه لتشغيله في ستريمو
            const embedHtml = await fetchHtml(iframeUrl, pageUrl);
            if (embedHtml) {
              // أ) استخراج الروابط المباشرة m3u8
              const m3u8Pattern = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
              let m3u8Match;
              while ((m3u8Match = m3u8Pattern.exec(embedHtml)) !== null) {
                let streamUrl = m3u8Match[0];
                if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
                  streamUrl = streamUrl.slice(0, -1);
                }
                if (!seen.has(streamUrl)) {
                  seen.add(streamUrl);
                  
                  let serverLabel = `سيرفر البث الرئيسي HLS (جودة ${server.quality}p)`;
                  if (streamUrl.includes("s1q2105.com")) serverLabel = `عرب سيد أساسي (HLS) - ${server.quality}p`;
                  if (streamUrl.includes("vmwesa.online")) serverLabel = `سيرفر سحابي VMW - ${server.quality}p`;
                  if (streamUrl.includes("r66nv9ed.com")) serverLabel = `سيرفر سريع Sprint - ${server.quality}p`;
                  if (streamUrl.includes("tnmr.org")) serverLabel = `سيرفر ممتاز Tnmr - ${server.quality}p`;

                  streams.push({
                    url: streamUrl,
                    title: serverLabel
                  });
                }
              }

              // ب) استخراج الروابط المباشرة MP4 (مثل Boutique)
              const mp4Pattern = /https?:\/\/[^\s"']+\.mp4[^\s"']*/gi;
              let mp4Match;
              while ((mp4Match = mp4Pattern.exec(embedHtml)) !== null) {
                let streamUrl = mp4Match[0];
                if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
                  streamUrl = streamUrl.slice(0, -1);
                }
                if (!seen.has(streamUrl)) {
                  seen.add(streamUrl);
                  
                  let serverLabel = `سيرفر MP4 مباشر (جودة ${server.quality}p)`;
                  if (streamUrl.includes("boutique")) serverLabel = `سيرفر Boutique المباشر - ${server.quality}p`;

                  streams.push({
                    url: streamUrl,
                    title: serverLabel
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // مسح احتياطي كلاسيكي من كود الصفحة الأساسية
  const $ = load(html);
  $("iframe, a, source, video").each((_i, el) => {
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
    console.log("[AsdPics] No Arabic title found for ID: " + imdbId);
    return [];
  }

  console.log("[AsdPics] Found title: " + meta.arabicTitle + " (E" + episode + ")");

  const pageUrl = await searchAsdPics(meta.arabicTitle, type, episode);
  if (!pageUrl) {
    console.log("[AsdPics] Target Page not found");
    return [];
  }

  console.log("[AsdPics] Found Page URL: " + pageUrl);
  const rawStreams = await extractStreams(pageUrl);

  return rawStreams.map(s => ({
    name: "Asd Pics by Abdulluh.X",
    title: `🎬 ${s.title}`,
    url: s.url,
    behaviorHints: {
      notWebReady: false,
      headers: {
        "Referer": `${WATCH_BASE}/`,
        "Origin": WATCH_BASE
      }
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
    console.log("[AsdPics] Streams count: " + streams.length);
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Error: " + e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

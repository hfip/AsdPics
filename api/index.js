const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const BASE_URL = "https://asd.pics";
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

const pageCache = new Map();
const PAGE_TTL = 3 * 60 * 1000;

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
    console.error("[-] Error fetching HTML:", err.message);
    return null;
  }
}

// دالة إرسال طلب POST بصيغة x-www-form-urlencoded لمحاكاة الـ Ajax
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": referer,
        "Origin": BASE_URL
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
  version: "1.5.0",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة متطورة لسحب البث والروابط بالاعتماد على منطق سحب وحماية Cloudstream الذكي",
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
    console.error("[-] TMDB fetch error:", e.message);
    return null;
  }
}

// البحث عن صفحة المادة في الموقع
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

// استخراج السيرفرات الفعلي والربط الثنائي لجلب الـ iFrame الحقيقي
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

  console.log(`[AsdPics] Extracted Details -> Post ID: ${postId} | CSRF Token: ${csrfToken}`);

  // 2. محاكاة طلبات POST المتتابعة بناءً على كود جلب سيرفرات عرب سيد
  if (csrfToken && postId) {
    const ajaxUrl = `${BASE_URL}/get__watch__server/`;

    // طلب الـ POST الأول: للحصول على قائمة السيرفرات المتوفرة (HTML يحتوي على خيارات data-server)
    const listServersData = {
      "post_id": postId,
      "csrf_token": csrfToken
    };

    console.log(`[AsdPics] Sending POST 1 (List Servers)...`);
    const listHtml = await postAjax(ajaxUrl, listServersData, pageUrl);

    if (listHtml) {
      const $list = load(listHtml);
      const serverElements = [];

      // سحب معرف السيرفرات والجودات المتاحة
      $list("li[data-server]").each((_i, el) => {
        const serverId = $list(el).attr("data-server");
        const quality = $list(el).attr("data-quality") || "1080"; // جودة افتراضية إذا لم تتوفر
        if (serverId) {
          serverElements.push({ id: serverId, quality: quality });
        }
      });

      console.log(`[AsdPics] Found (${serverElements.length}) servers inside list`);

      // طلب الـ POST الثاني لكل سيرفر: لجلب رابط الـ iframe والـ m3u8 الحقيقي
      for (const server of serverElements) {
        const serverDetailsData = {
          "post_id": postId,
          "quality": server.quality,
          "server": server.id,
          "csrf_token": csrfToken
        };

        console.log(`[AsdPics] Sending POST 2 for Server ID: ${server.id}`);
        const serverResponse = await postAjax(ajaxUrl, serverDetailsData, pageUrl);

        if (serverResponse) {
          try {
            // الاستجابة تأتي على هيئة JSON يحتوي على حقل الـ server (رابط الـ iframe)
            const parsed = JSON.parse(serverResponse);
            let iframeUrl = parsed.server || "";

            if (iframeUrl.startsWith("//")) iframeUrl = `https:${iframeUrl}`;

            if (iframeUrl && !seen.has(iframeUrl)) {
              seen.add(iframeUrl);
              const isHls = iframeUrl.includes("m3u8") || iframeUrl.includes("reviewrate");
              streams.push({
                url: iframeUrl,
                title: `سيرفر رئيسي (${isHls ? "HLS" : "MP4"}) - جودة ${server.quality}p`
              });
            }
          } catch (e) {
            // محاولة جلب رابط البث عبر الـ Regex في حال كانت الاستجابة HTML خام
            const iframeMatch = serverResponse.match(/src=["'](https?:\/\/[^"']+)["']/i);
            if (iframeMatch && !seen.has(iframeMatch[1])) {
              seen.add(iframeMatch[1]);
              streams.push({
                url: iframeMatch[1],
                title: `سيرفر مدمج - جودة ${server.quality}p`
              });
            }
          }
        }
      }
    }
  }

  // 3. مسح كلاسيكي احتياطي في حال تعطل نظام الـ Ajax
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
    title: `🎬 ${s.title} | عرب سيد 🌐`,
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
    console.log("[AsdPics] Streams count: " + streams.length);
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Error: " + e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

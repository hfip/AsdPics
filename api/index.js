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

const pageCache = new Map();
const PAGE_TTL = 3 * 60 * 1000;

async function fetchHtml(url, referer = BASE_URL) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.3",
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

// دالة إرسال طلب الـ POST لمحاكاة الـ Ajax الخاص بـ ReviewRate وسحب السيرفرات
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
  version: "1.7.0",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة متطورة لسحب البث المباشر (m3u8 و mp4) من سيرفرات عرب سيد والمشغل الرئيسي تلقائياً",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// استخراج روابط الفيديو المباشرة بالاعتماد على التوكن وجلب السيرفرات بالخلفية
async function extractDirectStreams(imdbId) {
  const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
  const html = await fetchHtml(watchUrl, "https://asd.pics/");
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  // 1. استخراج الـ csrf_token والـ post_id (objId) من صفحة المشاهدة
  const csrfTokenMatch = html.match(/['" ]csrf_token['" ]\s*:\s*['"]([^'"]+)['"]/);
  const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;

  // استخراج معرّف الفيديو (Post ID / Object ID) من الصفحة
  let objId = null;
  const objIdMatch = html.match(/['" ]objId['" ]\s*:\s*['" ]?(\d+)['" ]?/i) || html.match(/post_id['" ]\s*:\s*['" ]?(\d+)['" ]?/i);
  if (objIdMatch) {
    objId = objIdMatch[1];
  }

  console.log(`[AsdPics] Watch Details -> ObjID: ${objId} | CSRF Token: ${csrfToken}`);

  // 2. إذا توفرت البيانات، نرسل طلب الـ POST لمحاكاة جلب السيرفرات
  if (csrfToken && objId) {
    const ajaxUrl = `${WATCH_BASE}/get__watch__server/`;
    const postData = {
      "post_id": objId,
      "csrf_token": csrfToken
    };

    console.log(`[AsdPics] Requesting direct stream servers via Ajax...`);
    const ajaxResponse = await postAjax(ajaxUrl, postData, watchUrl);

    if (ajaxResponse) {
      // أ) البحث عن روابط البث m3u8 مباشرة من داخل الـ Ajax Response
      const m3u8Pattern = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
      let m3u8Match;
      while ((m3u8Match = m3u8Pattern.exec(ajaxResponse)) !== null) {
        let streamUrl = m3u8Match[0];
        if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
          streamUrl = streamUrl.slice(0, -1);
        }
        if (!seen.has(streamUrl)) {
          seen.add(streamUrl);
          
          let serverName = "سيرفر رئيسي ملقط";
          if (streamUrl.includes("s1q2105.com")) serverName = "سيرفر عرب سيد الأساسي (سريع)";
          if (streamUrl.includes("vmwesa.online")) serverName = "سيرفر احتياطي VMW";
          if (streamUrl.includes("r66nv9ed.com")) serverName = "سيرفر سحابي رائع";
          if (streamUrl.includes("tnmr.org")) serverName = "سيرفر ممتاز HLS";

          streams.push({
            url: streamUrl,
            title: `📺 ${serverName} (HLS/M3U8)`
          });
        }
      }

      // ب) البحث عن روابط الـ MP4 المباشرة (مثل سيرفر Boutique ومثيلاته)
      const mp4Pattern = /https?:\/\/[^\s"']+\.mp4[^\s"']*/gi;
      let mp4Match;
      while ((mp4Match = mp4Pattern.exec(ajaxResponse)) !== null) {
        let streamUrl = mp4Match[0];
        if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
          streamUrl = streamUrl.slice(0, -1);
        }
        if (!seen.has(streamUrl)) {
          seen.add(streamUrl);
          
          let serverName = "سيرفر MP4 مباشر";
          if (streamUrl.includes("boutique")) serverName = "سيرفر Boutique (جودة عالية)";

          streams.push({
            url: streamUrl,
            title: `🎬 ${serverName} (MP4)`
          });
        }
      }

      // ج) استخراج أي iframe مدمج للحلقات في الـ Ajax للبحث بداخله
      const iframeMatches = ajaxResponse.match(/src=["'](https?:\/\/[^"']+)["']/gi);
      if (iframeMatches) {
        for (let matchText of iframeMatches) {
          let embedIframeUrl = matchText.match(/src=["']([^"']+)["']/i)[1];
          if (embedIframeUrl && !seen.has(embedIframeUrl)) {
            // محاولة سحب الفيديو من الـ iframe المدمج
            const embedHtml = await fetchHtml(embedIframeUrl, watchUrl);
            if (embedHtml) {
              const innerM3u8 = embedHtml.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi);
              if (innerM3u8) {
                innerM3u8.forEach(url => {
                  if (!seen.has(url)) {
                    seen.add(url);
                    streams.push({
                      url: url,
                      title: "📺 سيرفر مدمج HLS (M3U8)"
                    });
                  }
                });
              }
            }
          }
        }
      }
    }
  }

  // 3. Fallback: إذا لم نجد أي روابط (بسبب حماية مؤقتة)، نرجع رابط المشاهدة كخيار أخير
  if (streams.length === 0) {
    streams.push({
      url: watchUrl,
      title: "🌐 سيرفر خارجي (اضغط للتشغيل بمتصفح الويب)"
    });
  }

  return streams;
}

// مسارات ستريمو
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

  console.log(`[AsdPics] New Stream Request for IMDB ID: ${imdbId}`);

  try {
    const rawStreams = await extractDirectStreams(imdbId);
    
    // صياغة الروابط بالطريقة القياسية لستريمو لتظهر فوراً في المشغل
    const streams = rawStreams.map(s => ({
      name: "Asd Pics by Abdulluh.X",
      title: s.title,
      url: s.url,
      behaviorHints: {
        notWebReady: false,
        headers: {
          "Referer": `${WATCH_BASE}/`,
          "Origin": WATCH_BASE
        }
      }
    }));

    console.log(`[AsdPics] Found and structured (${streams.length}) direct stream links`);
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Error occurred while extracting streams:", e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

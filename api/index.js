const express = require("express");
const cors = require("cors");

// استيراد node-fetch المتوافق مع بيئة Vercel
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const WATCH_BASE = "https://m.reviewrate.net";

// إعداد الهيدرز المطابقة تماماً لتطبيق كلاود ستريم لضمان تجاوز الفلترة
const EXACT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Upgrade-Insecure-Requests": "1"
};

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "2.1.0",
  name: "Asd Pics by Abdulluh.X",
  description: "سحب البث المباشر لروابط عرب سيد (m3u8 / mp4) وتشغيلها داخلياً في ستريمو",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// دالة جلب كود HTML الخاص بصفحة المشغل الرئيسي
async function getWatchPageHtml(embedUrl) {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        ...EXACT_HEADERS,
        "Referer": "https://asd.pics/"
      },
      timeout: 8000
    });
    return await res.text();
  } catch (err) {
    console.error("[-] Error loading watch page:", err.message);
    return null;
  }
}

// دالة إرسال طلب الـ POST لاستخراج السيرفرات الفعلية (Ajax)
async function getWatchServersAjax(postId, csrfToken, embedUrl) {
  try {
    const params = new URLSearchParams();
    params.append("post_id", postId);
    params.append("csrf_token", csrfToken);

    const res = await fetch(`${WATCH_BASE}/get__watch__server/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": EXACT_HEADERS["User-Agent"],
        "Referer": embedUrl,
        "Origin": WATCH_BASE
      },
      body: params.toString(),
      timeout: 8000
    });
    return await res.text();
  } catch (err) {
    console.error("[-] Ajax request failed:", err.message);
    return null;
  }
}

// دالة السحب الأساسية المتوافقة تماماً مع سيرفر عرب سيد (GameHub)
async function extractGameHubStreams(imdbId) {
  const streams = [];
  const seen = new Set();

  // صياغة رابط صفحة التوجيه المباشرة للمشغل
  const embedUrl = `${WATCH_BASE}/embed-${imdbId}.html`;
  const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;

  // 1. محاولة جلب كود الصفحة الأساسية للمشغل
  let html = await getWatchPageHtml(embedUrl);
  if (!html) {
    html = await getWatchPageHtml(watchUrl);
  }

  if (!html) return [];

  // 2. استخراج الـ csrf_token والـ post_id (objId) من كود الصفحة
  const csrfTokenMatch = html.match(/['" ]csrf_token['" ]\s*:\s*['"]([^'"]+)['"]/);
  const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;

  let objId = null;
  const objIdMatch = html.match(/['" ]objId['" ]\s*:\s*['" ]?(\d+)['" ]?/i) || html.match(/post_id['" ]\s*:\s*['" ]?(\d+)['" ]?/i);
  if (objIdMatch) {
    objId = objIdMatch[1];
  } else {
    // محاولة إضافية لاستخراج المعرف من الرابط نفسه
    objId = imdbId.replace(/\D/g, "");
  }

  console.log(`[AsdPics] Details -> PostID: ${objId} | Token: ${csrfToken}`);

  // 3. في حال توفر الـ Token، نقوم بطلب الـ Ajax الفعلي ومسح الروابط
  if (csrfToken && objId) {
    const ajaxResponse = await getWatchServersAjax(objId, csrfToken, embedUrl);

    if (ajaxResponse) {
      // أ) البحث عن روابط m3u8 من استجابة الـ Ajax
      const m3u8Pattern = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
      let m3u8Match;
      while ((m3u8Match = m3u8Pattern.exec(ajaxResponse)) !== null) {
        let streamUrl = m3u8Match[0];
        if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
          streamUrl = streamUrl.slice(0, -1);
        }
        if (!seen.has(streamUrl)) {
          seen.add(streamUrl);

          let serverLabel = "سيرفر البث الرئيسي HLS";
          if (streamUrl.includes("s1q2105.com")) serverLabel = "عرب سيد أساسي (HLS)";
          if (streamUrl.includes("vmwesa.online")) serverLabel = "سيرفر سحابي VMW";
          if (streamUrl.includes("r66nv9ed.com")) serverLabel = "سيرفر Sprint CDN";
          if (streamUrl.includes("tnmr.org")) serverLabel = "سيرفر ممتاز HLS";

          streams.push({
            url: streamUrl,
            title: serverLabel
          });
        }
      }

      // ب) البحث عن روابط MP4 من استجابة الـ Ajax (مثل Boutique)
      const mp4Pattern = /https?:\/\/[^\s"']+\.mp4[^\s"']*/gi;
      let mp4Match;
      while ((mp4Match = mp4Pattern.exec(ajaxResponse)) !== null) {
        let streamUrl = mp4Match[0];
        if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
          streamUrl = streamUrl.slice(0, -1);
        }
        if (!seen.has(streamUrl)) {
          seen.add(streamUrl);

          let serverLabel = "سيرفر MP4 مباشر";
          if (streamUrl.includes("boutique")) serverLabel = "سيرفر Boutique المباشر";

          streams.push({
            url: streamUrl,
            title: serverLabel
          });
        }
      }
    }
  }

  // 4. فحص احتياطي لكود الـ HTML الأساسي في حال كانت الروابط مكتوبة مباشرة فيه
  const directLinksPattern = /https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi;
  let directMatch;
  while ((directMatch = directLinksPattern.exec(html)) !== null) {
    let streamUrl = directMatch[0];
    if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
      streamUrl = streamUrl.slice(0, -1);
    }
    if (!seen.has(streamUrl) && !streamUrl.includes("templates") && !streamUrl.includes("assets")) {
      seen.add(streamUrl);
      const isHls = streamUrl.includes(".m3u8");
      streams.push({
        url: streamUrl,
        title: `سيرفر مباشر احتياطي (${isHls ? "HLS" : "MP4"})`
      });
    }
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
  const imdbId = parts[0]; // استخراج الـ imdb id الفعلي (مثل: tt1757678)

  console.log(`[AsdPics] Extractor request received for: ${imdbId}`);

  try {
    const rawStreams = await extractGameHubStreams(imdbId);
    
    // إرسال الروابط لستريمو كبث مباشر
    const streams = rawStreams.map(s => ({
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

    console.log(`[AsdPics] Streams successfully extracted count: ${streams.length}`);
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Extraction error:", e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

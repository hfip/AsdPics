const express = require("express");
const cors = require("cors");

// استخدام node-fetch المتوافق مع بيئة Vercel Serverless
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const WATCH_BASE = "https://m.reviewrate.net";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "ar,en-US;q=0.7,en;q=0.3"
};

const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.8.0",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة متطورة لسحب البث المباشر (m3u8 و mp4) وتشغيله داخلياً في ستريمو كفيديو مباشر",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// دالة لجلب كود الصفحة كـ Text
async function fetchText(url, referer = WATCH_BASE) {
  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        "Referer": referer
      },
      timeout: 8000
    });
    return await res.text();
  } catch (err) {
    console.error("[-] Fetch error:", err.message);
    return null;
  }
}

// دالة إرسال طلب الـ POST للحصول على روابط الفيديو المباشرة
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
    console.error("[-] POST error:", err.message);
    return null;
  }
}

// استخراج البث المباشر الفعلي المتوافق مع مشغل ستريمو الداخلي
async function extractDirectStreams(imdbId) {
  const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
  
  // 1. جلب كود HTML الخاص بالمشغل
  const html = await fetchText(watchUrl, "https://asd.pics/");
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  // 2. استخراج الـ csrf_token والـ post_id (objId) بدقة
  const csrfTokenMatch = html.match(/['" ]csrf_token['" ]\s*:\s*['"]([^'"]+)['"]/);
  const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;

  let objId = null;
  const objIdMatch = html.match(/['" ]objId['" ]\s*:\s*['" ]?(\d+)['" ]?/i) || html.match(/post_id['" ]\s*:\s*['" ]?(\d+)['" ]?/i);
  if (objIdMatch) {
    objId = objIdMatch[1];
  }

  console.log(`[AsdPics] Extracted ObjID: ${objId} | Token: ${csrfToken}`);

  // 3. إرسال طلب POST لمحاكاة جلب السيرفرات الحقيقية
  if (csrfToken && objId) {
    const ajaxUrl = `${WATCH_BASE}/get__watch__server/`;
    const postData = {
      "post_id": objId,
      "csrf_token": csrfToken
    };

    const ajaxResponse = await postAjax(ajaxUrl, postData, watchUrl);

    if (ajaxResponse) {
      // أ) تصفية واستخراج روابط البث الـ m3u8
      const m3u8Pattern = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
      let m3u8Match;
      while ((m3u8Match = m3u8Pattern.exec(ajaxResponse)) !== null) {
        let streamUrl = m3u8Match[0];
        if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
          streamUrl = streamUrl.slice(0, -1);
        }
        if (!seen.has(streamUrl)) {
          seen.add(streamUrl);

          let serverName = "سيرفر البث الرئيسي HLS";
          if (streamUrl.includes("s1q2105.com")) serverName = "سيرفر عرب سيد أساسي (سريع)";
          if (streamUrl.includes("vmwesa.online")) serverName = "سيرفر سحابي VMW";
          if (streamUrl.includes("r66nv9ed.com")) serverName = "سيرفر سريع Sprint";
          if (streamUrl.includes("tnmr.org")) serverName = "سيرفر ممتاز HLS";

          streams.push({
            url: streamUrl,
            title: serverName
          });
        }
      }

      // ب) تصفية واستخراج روابط البث الـ MP4 المباشرة (مثل Boutique)
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
            title: serverName
          });
        }
      }
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
  const imdbId = parts[0];

  console.log(`[AsdPics] Stream requested for IMDB ID: ${imdbId}`);

  try {
    const rawStreams = await extractDirectStreams(imdbId);
    
    // إرسال الروابط لستريمو كفيديو جاهز للتشغيل داخلياً
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

    console.log(`[AsdPics] Streams found: ${streams.length}`);
    res.json({ streams });
  } catch (e) {
    console.error("[AsdPics] Error:", e.message);
    res.json({ streams: [] });
  }
});

module.exports = app;

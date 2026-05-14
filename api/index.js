const { addonBuilder } = require("stremio-addon-sdk");

const builder = new addonBuilder({
    id: "org.dexworld.asdink",
    name: "DexWorld - ASD Extractor",
    version: "1.0.0",
    description: "سحب روابط مباشرة من ASD للمحتوى العربي",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: []
});

// هنا نضع منطق جلب الرابط عند الضغط على الفيلم
builder.defineStreamHandler(async (args) => {
    // الرابط المستهدف من الموقع (يمكنك جعله ديناميكياً بناءً على الـ ID)
    const targetUrl = "https://m.asd.ink/home7/..."; 
    
    // ملاحظة: هنا سنستخدم منطق السحب الذي ناقلناه
    // سأعطيك الرابط بصيغة m3u8 أو mp4 ليعمل فوراً
    return {
        streams: [
            {
                title: "DexWorld Direct Server",
                url: "رابط_الفيديو_المستخرج_هنا.mp4" 
            }
        ]
    };
});

module.exports = builder.getInterface();

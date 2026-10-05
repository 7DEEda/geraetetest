// Die Suite des Geräte-Tests. geraete-test.html arbeitet diese Liste ab.
//
// Ein Baustein:
//   id      Kennung, unter der das Ergebnis gespeichert wird (nie umbenennen, sonst passen alte Läufe nicht mehr)
//   titel   Zeile in der Liste
//   bezug   wofür die App es braucht
//   block   "auto" | "hand" | "neu": die Überschrift, unter der die Zeile steht
//   selbst  true: läuft nach dem einen Tipp von allein (in "auto" immer)
//   hand    Anweisung, wenn der Schritt eine Hand braucht (Text oder Liste von Teilschritten)
//   kopf    Überschrift des Schritt-Bildschirms (sonst titel)
//   frage   Ja/Nein-Rückfrage nach dem Lauf; "Nein" macht aus ok ein "geht nicht"
//   grenze  Zeitgrenze in Sekunden (Standard 30, mit hand 100)
//   lauf    async (ctx) => { art: "ok" | "warn" | "err", wert: "kurz", mess: { ... } }
//
// ctx: rpc(fn, args), cfg {url, key}, warte(ms), status(text), sensor (Ausrichtung, siehe geraete-test.html),
//      bewegung (Ergebnis der iOS-Nachfrage), wach (gehaltener Wake Lock), feld (Element in der Zeile für Vorschau)
//
// Neue Funktion: Baustein anhängen und version hochzählen.
(function () {
  const KOMPASS_GRENZE = 25;   // wie in der App
  const jetzt = () => performance.now();
  const rund = (x, n = 0) => x == null ? null : Math.round(x * 10 ** n) / 10 ** n;
  const komma = (x, n = 1) => x.toFixed(n).replace(".", ",");
  const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const janein = b => b ? "ja" : "nein";

  function bisSichtbarWechsel(ctx, maxMs) {
    // wartet auf "weg" und "wieder da"; gibt zurück, wie lange die Seite weg war
    return new Promise((res, rej) => {
      let weg = null;
      const aus = setTimeout(() => { document.removeEventListener("visibilitychange", h); rej(new Error("Die Seite war nie im Hintergrund.")); }, maxMs);
      function h() {
        if (document.visibilityState === "hidden") { weg = Date.now(); ctx.status("weg …"); }
        else if (weg != null) { clearTimeout(aus); document.removeEventListener("visibilitychange", h); res(Date.now() - weg); }
      }
      document.addEventListener("visibilitychange", h);
    });
  }

  function standortEinmal(timeout) {
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej,
      { enableHighAccuracy: true, timeout, maximumAge: 0 }));
  }

  const tests = [
    /* ================= von allein ================= */
    {
      id: "umgebung", titel: "Umgebung", bezug: "ordnet den Lauf dem Gerät zu", block: "auto",
      async lauf() {
        const ua = navigator.userAgent;
        let os = "unbekannt", m;
        if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/))) os = `iOS ${m[1]}.${m[2]}`;
        else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) os = "Android " + m[1];
        else if (/Macintosh/.test(ua)) os = navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS";
        else if (/Windows/.test(ua)) os = "Windows";
        else if (/Linux/.test(ua)) os = "Linux";
        const browser = /CriOS/.test(ua) ? "Chrome (iOS)" : /FxiOS/.test(ua) ? "Firefox (iOS)" : /EdgiOS|EdgA|Edg\//.test(ua) ? "Edge"
          : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox/.test(ua) ? "Firefox" : /OPR\//.test(ua) ? "Opera"
          : /Chrome\//.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "unbekannt";
        const inApp = (ua.match(/FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|Teams|LinkedInApp|GSA\/|; wv\)/) || [null])[0];
        // Chrome auf Android friert die Kennung auf "Android 10; K" ein. Version und Modell gibt es nur auf Nachfrage.
        let modell = null;
        try {
          if (navigator.userAgentData?.getHighEntropyValues) {
            const h = await navigator.userAgentData.getHighEntropyValues(["model", "platformVersion"]);
            if (h.model) modell = h.model;
            if (h.platform === "Android" && h.platformVersion) os = "Android " + h.platformVersion.split(".")[0];
          }
        } catch { /* dann bleibt es bei der Kennung */ }
        // Geräteart: kein Browser sagt sie direkt, wir schließen aus Kennung, Zeiger und Bildschirm
        const mobil = navigator.userAgentData?.mobile ?? /Mobi|iPhone|iPod/.test(ua);
        const grob = matchMedia("(pointer: coarse)").matches, kurz = Math.min(screen.width, screen.height);
        // iPad zuerst: mit mobiler Kennung ("iPad; ... Mobile/15E148") hielt der Test es sonst für ein Telefon
        const art = /iPad/.test(ua) || os === "iPadOS" ? "Tablet"
          : /iPhone|iPod/.test(ua) || mobil ? "Telefon"
          : /Android/.test(ua) || (grob && kurz >= 600) ? "Tablet"
          : navigator.maxTouchPoints > 0 ? "Laptop mit Touch" : "Laptop oder PC";
        let akku = null;
        try { if (navigator.getBattery) { const b = await navigator.getBattery(); akku = Math.round(b.level * 100) + " %" + (b.charging ? ", lädt" : ""); } } catch { /* egal */ }
        const mess = {
          "Geräteart": art, "Modell": modell || "keine Angabe", "Betriebssystem": os, "Browser": browser, "In-App-Browser": inApp || "nein",
          "HTTPS": janein(window.isSecureContext), "Bildschirm": `${screen.width} x ${screen.height}, Faktor ${rund(devicePixelRatio, 2)}`,
          "Fenster": `${innerWidth} x ${innerHeight}`, "Zeiger": grob ? "Finger" : "Maus", "Berührungspunkte": navigator.maxTouchPoints, "Als App installiert": janein(matchMedia("(display-mode: standalone)").matches || navigator.standalone === true),
          "Sprache": navigator.language, "Netz laut Browser": navigator.connection ? `${navigator.connection.effectiveType || "?"}, ${navigator.connection.downlink ?? "?"} Mbit/s` : "keine Angabe",
          "Akku": akku || "keine Angabe", "Dunkles Design": janein(matchMedia("(prefers-color-scheme: dark)").matches), "Kennung": ua
        };
        if (!window.isSecureContext) return { art: "err", wert: "kein HTTPS", mess };
        if (inApp) return { art: "warn", wert: "In-App-Browser", mess };
        return { art: "ok", wert: `${art}, ${modell ? modell + ", " : ""}${os}, ${browser}`, mess };
      }
    },
    {
      id: "speicher", titel: "Speicher", bezug: "merkt sich Einstellungen", block: "auto",
      async lauf() {
        const probe = name => { try { const s = window[name]; s.setItem("gt._t", "1"); const ok = s.getItem("gt._t") === "1"; s.removeItem("gt._t"); return ok; } catch { return false; } };
        const ls = probe("localStorage"), ss = probe("sessionStorage");
        let platz = "keine Angabe";
        try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); platz = Math.round((e.quota || 0) / 1048576) + " MB"; } } catch { /* egal */ }
        let dauerhaft = "keine Angabe";
        try { if (navigator.storage?.persisted) dauerhaft = janein(await navigator.storage.persisted()); } catch { /* egal */ }
        const mess = { "localStorage": janein(ls), "sessionStorage": janein(ss), "Cookies": janein(navigator.cookieEnabled), "Platz": platz, "Dauerhaft zugesagt": dauerhaft };
        return ls ? { art: "ok", wert: "schreibt", mess } : { art: "err", wert: "gesperrt", mess };
      }
    },
    {
      id: "server", titel: "Server", bezug: "Verbindung zum Server", block: "auto",
      async lauf(ctx) {
        const zeiten = [];
        // neutrale Abfrage: gibt nur Größe und Serverzeit zurück
        for (let i = 0; i < 5; i++) { const t = jetzt(); await ctx.rpc("device_test_echo", { p_data: "" }); zeiten.push(Math.round(jetzt() - t)); }
        const med = median(zeiten);
        const mess = { "5 Abfragen in ms": zeiten.join(", "), "Median in ms": med };
        return { art: med <= 800 ? "ok" : med <= 3000 ? "warn" : "err", wert: med + " ms", mess };
      }
    },
    {
      id: "uhr", titel: "Uhr", bezug: "für Zeitangaben", block: "auto",
      async lauf(ctx) {
        let beste = null;
        for (let i = 0; i < 3; i++) {
          const t0 = Date.now(), r = await ctx.rpc("device_test_echo", { p_data: "" }), t1 = Date.now();
          const lauf = t1 - t0, ab = (t0 + t1) / 2 - Date.parse(r.serverTime);
          if (!beste || lauf < beste.lauf) beste = { lauf, ab };
        }
        const s = beste.ab / 1000, b = Math.abs(s);
        const mess = { "Abweichung in s": rund(s, 2), "Laufzeit der Messung in ms": beste.lauf, "Zeitzone": Intl.DateTimeFormat().resolvedOptions().timeZone };
        return { art: b <= 5 ? "ok" : b <= 60 ? "warn" : "err", wert: b < 0.05 ? "genau" : (s >= 0 ? "+" : "-") + komma(b) + " s", mess };
      }
    },
    {
      id: "standort", titel: "Standort", bezug: "für die Ortung", block: "auto", grenze: 45,
      async lauf(ctx) {
        if (!navigator.geolocation) return { art: "err", wert: "fehlt", mess: { "Geolocation": "nicht vorhanden" } };
        let vorher = "keine Angabe";
        try { vorher = (await navigator.permissions?.query({ name: "geolocation" }))?.state || vorher; } catch { /* Safari kennt die Abfrage teils nicht */ }
        const start = jetzt(); let erst = null, beste = null, n = 0, letzte = null, fehler = null;
        const id = navigator.geolocation.watchPosition(p => {
          n++; letzte = p;
          if (erst == null) erst = jetzt() - start;
          if (beste == null || p.coords.accuracy < beste) beste = p.coords.accuracy;
          ctx.status("±" + Math.round(p.coords.accuracy) + " m");
        }, e => { fehler = e; }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        // bis zum ersten Fix höchstens 20 s, danach noch 10 s zuhören, ob es genauer wird
        while (erst == null && !fehler && jetzt() - start < 21000) await ctx.warte(200);
        const ab = jetzt();
        while (erst != null && jetzt() - ab < 10000 && !(beste <= 8)) await ctx.warte(200);
        navigator.geolocation.clearWatch(id);
        if (erst == null) {
          const grund = fehler ? ({ 1: "abgelehnt", 2: "nicht verfügbar", 3: "keine Antwort" }[fehler.code] || "Fehler") : "keine Antwort";
          return { art: "err", wert: grund, mess: { "Erlaubnis vorher": vorher, "Fehler": fehler ? `${fehler.code}: ${fehler.message}` : "20 s ohne Antwort" } };
        }
        const c = letzte.coords;
        const mess = {
          "Erlaubnis vorher": vorher, "Erster Fix nach s": rund(erst / 1000, 1), "Beste Genauigkeit in m": rund(beste),
          // keine Position und keine Höhe speichern (Entscheidung 02.10.2026: der Test ist anonym), nur ob es sie gibt
          "Meldungen": n, "Höhe gemeldet": janein(c.altitude != null),
          "Bewegungsrichtung gemeldet": janein(!(c.heading == null || Number.isNaN(c.heading))),
          "Brauchbar wäre": "unter ±25 m"
        };
        // über einem Kilometer ist es kein schlechter Empfang, sondern die Einstellung "nur ungefährer Standort"
        if (beste > 1000) {
          mess["Hinweis"] = "Das Handy gibt nur den ungefähren Standort frei. iPhone: Einstellungen, Datenschutz und Sicherheit, Ortungsdienste, Safari-Websites, Genauer Standort einschalten. Android: Einstellungen, Standort, App-Berechtigungen, Browser, Genauen Standort verwenden.";
          return { art: "err", wert: "nur ungefähr", mess };
        }
        return { art: beste <= 25 ? "ok" : beste <= 100 ? "warn" : "err", wert: "±" + Math.round(beste) + " m", mess };
      }
    },
    {
      id: "kompass", titel: "Kompass", bezug: "für den Richtungspfeil", block: "auto",
      async lauf(ctx) {
        const s = ctx.sensor;
        if (!window.DeviceOrientationEvent) return { art: "err", wert: "fehlt", mess: { "DeviceOrientationEvent": "nicht vorhanden" } };
        const n0 = s.n, t0 = jetzt();
        await ctx.warte(3000);
        const n = s.n - n0, rate = Math.round(n / ((jetzt() - t0) / 1000));
        const mess = {
          "Erlaubnis Bewegung": ctx.bewegung, "Ereignisse pro Sekunde": rate, "Quelle": s.quelle || "keine",
          "Richtung": s.richtung == null ? "keine" : Math.round(s.richtung) + "°",
          "Genauigkeit": s.genau == null ? "meldet das Gerät nicht" : "±" + rund(s.genau, 1) + "°",
          "deviceorientationabsolute": janein("ondeviceorientationabsolute" in window)
        };
        // Chrome meldet nur Änderungen: liegt das Handy still, kommt in 3 s nichts Neues, obwohl die Richtung längst da ist
        if (!n && s.richtung != null && s.quelle && s.quelle !== "relativ") {
          mess["Hinweis"] = "In den 3 s kam kein neues Ereignis, das Handy lag vermutlich still. Die Richtung war schon vorher da.";
          return { art: "ok", wert: "Nordbezug", mess };
        }
        if (!n) return { art: "err", wert: "keine Daten", mess };
        if (s.quelle === "relativ" || s.richtung == null) return { art: "err", wert: "kein Nordbezug", mess };
        if (s.genau != null && (s.genau < 0 || s.genau > KOMPASS_GRENZE)) return { art: "warn", wert: s.genau < 0 ? "nicht kalibriert" : "±" + Math.round(s.genau) + "°", mess };
        return { art: "ok", wert: s.genau != null ? "±" + Math.round(s.genau) + "°" : "Nordbezug", mess };
      }
    },
    {
      id: "neigung", titel: "Neigung", bezug: "bewegt den Hintergrund mit", block: "auto",
      async lauf(ctx) {
        const s = ctx.sensor, ruhig = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const mess = { "beta / gamma": s.beta == null ? "keine" : `${rund(s.beta, 1)} / ${rund(s.gamma, 1)}`, "Reduzierte Bewegung": janein(ruhig),
          "Scroll-Parallax (animation-timeline)": janein(CSS.supports("animation-timeline: scroll()")) };
        if (s.beta == null) return { art: "err", wert: "keine Daten", mess };
        if (ruhig) return { art: "warn", wert: "abgeschaltet", mess };
        return { art: "ok", wert: "läuft", mess };
      }
    },
    {
      id: "wachhalten", titel: "Wach halten", bezug: "damit das Handy unterwegs nicht sperrt", block: "auto",
      async lauf(ctx) {
        if (!navigator.wakeLock) return { art: "err", wert: "fehlt", mess: { "navigator.wakeLock": "nicht vorhanden" } };
        // Seit Suite 8 fragt die Seite beim Laden, vor jedem Fingertipp (ctx.wach.vorab). Ohne das: jetzt fragen.
        const lage = ctx.wach.vorabLage || { "Tipp gilt noch (userActivation)": navigator.userActivation ? (navigator.userActivation.isActive ? "ja" : "nein") : "keine Angabe", "Seite sichtbar": document.visibilityState };
        lage["Gefragt"] = ctx.wach.vorab ? "beim Laden der Seite" : "im automatischen Teil";
        const v = ctx.wach.vorab ? await ctx.wach.vorab : await navigator.wakeLock.request("screen").then(l => ({ l }), e => ({ e }));
        if (v.l) { ctx.wach.sperre = v.l; ctx.wach.ohneTipp = "erteilt"; return { art: "ok", wert: "erteilt", mess: { "navigator.wakeLock": "ja", ...lage } }; }
        ctx.wach.ohneTipp = "verweigert";
        return { art: "warn", wert: "verweigert", mess: { "Fehler": v.e.name + ": " + v.e.message, ...lage, "Hinweis": "Mögliche Gründe: Stromsparmodus, oder das Gerät vergibt die Sperre nur direkt aus einem Fingertipp. „Wach halten, mit Tipp“ klärt das." } };
      }
    },
    {
      id: "karte", titel: "Karte", bezug: "für Kartenansichten", block: "auto",
      async lauf() {
        const mess = {}; let ok = true;
        let t = jetzt();
        try { const r = await fetch("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", { cache: "no-store" }); if (!r.ok) throw new Error(r.status); await r.text(); mess["Leaflet von unpkg in ms"] = Math.round(jetzt() - t); }
        catch (e) { ok = false; mess["Leaflet von unpkg"] = "lädt nicht: " + e.message; }
        t = jetzt();
        try {
          await new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = () => rej(new Error("Fehler")); i.src = "https://a.tile.openstreetmap.org/15/17696/11100.png"; });
          mess["OSM-Kachel in ms"] = Math.round(jetzt() - t);
        } catch { ok = false; mess["OSM-Kachel"] = "lädt nicht"; }
        if (!ok) return { art: "err", wert: "lädt nicht", mess };
        const summe = mess["Leaflet von unpkg in ms"] + mess["OSM-Kachel in ms"];
        return { art: summe <= 3000 ? "ok" : "warn", wert: komma(summe / 1000) + " s", mess };
      }
    },
    {
      id: "schrift", titel: "Schrift", bezug: "für das Aussehen", block: "auto",
      async lauf() {
        const kopf = '700 19px "Barlow Semi Condensed"', text = "400 17px Barlow";
        try { await Promise.all([document.fonts.load(kopf), document.fonts.load(text)]); } catch { /* prüfen wir gleich */ }
        const k = document.fonts.check(kopf), t = document.fonts.check(text);
        const mess = { "Barlow Semi Condensed": janein(k), "Barlow": janein(t) };
        return k && t ? { art: "ok", wert: "Barlow", mess } : { art: "warn", wert: "Ersatzschrift", mess };
      }
    },
    {
      // Ob die Seite den Akku lesen darf: für eine Warnung bei knappem Akku (Chrome und Edge auf Android ja, Safari nie, Firefox nicht mehr)
      id: "akku", titel: "Akku", bezug: "für eine Warnung bei knappem Akku", block: "auto",
      async lauf() {
        if (typeof navigator.getBattery !== "function") return { art: "warn", wert: "nicht lesbar", mess: { "navigator.getBattery": "nicht vorhanden",
          "Hinweis": "Dieser Browser gibt den Akku nicht an Webseiten heraus (Safari auf iPhone und iPad, Firefox). Eine Akku-Warnung gibt es hier nicht." } };
        try {
          const b = await navigator.getBattery();
          const mess = { "Stand": Math.round(b.level * 100) + " %", "Lädt": janein(b.charging),
            "Voll in": b.charging && isFinite(b.chargingTime) ? Math.round(b.chargingTime / 60) + " min" : "keine Angabe",
            "Leer in": !b.charging && isFinite(b.dischargingTime) ? Math.round(b.dischargingTime / 60) + " min" : "keine Angabe" };
          return { art: "ok", wert: Math.round(b.level * 100) + " %" + (b.charging ? ", lädt" : ""), mess };
        } catch (e) { return { art: "warn", wert: "nicht lesbar", mess: { "Fehler": e.name + ": " + e.message } }; }
      }
    },
    {
      id: "teilen", titel: "Teilen", bezug: "für das Teilen von Links", block: "auto",
      async lauf() {
        const a = typeof navigator.share === "function", b = !!navigator.clipboard?.writeText;
        const mess = { "Teilen-Dialog": janein(a), "Zwischenablage": janein(b) };
        return { art: a && b ? "ok" : a || b ? "warn" : "err", wert: a && b ? "beides" : a ? "nur Teilen" : b ? "nur Kopieren" : "fehlt", mess };
      }
    },

    /* ================= mit der Hand ================= */
    {
      // Wie das Einmessen in der App: gezählt wird nur Schwenken über 80°/s, 5 s zusammen.
      // Danach zeigt "Handy einmal drehen", wie gut der Kompass nach dem Einmessen ist.
      id: "kompass-einmessen", titel: "Kompass einmessen", bezug: "Acht schwenken vor dem Drehen", block: "hand",
      kopf: "Kompass einmessen", hand: "Halt das Handy vor dich und schwenk es ein paar Mal in einer liegenden Acht. Dreh und kipp es dabei in alle Richtungen.", grenze: 40,
      async lauf(ctx) {
        const s = ctx.sensor, t0 = jetzt(), vorher = s.genau;
        s.kal = { bewegt: 0, letzt: null };
        while (s.kal.bewegt < 5000 && jetzt() - t0 < 30000) {
          ctx.status(s.kal.bewegt > 0 ? `Weiter so, ${Math.min(99, Math.round(s.kal.bewegt / 50))} %` : "Wartet auf Bewegung");
          await ctx.warte(150);
        }
        const bewegt = s.kal.bewegt; s.kal = null;
        ctx.status(bewegt >= 5000 ? "Fertig" : "Zu wenig geschwenkt");
        const mess = { "Geschwenkt in s": rund(bewegt / 1000, 1), "Dauer in s": rund((jetzt() - t0) / 1000, 1),
          "Genauigkeit vorher": vorher == null ? "meldet das Gerät nicht" : "±" + Math.round(vorher) + "°",
          "Genauigkeit nachher": s.genau == null ? "meldet das Gerät nicht" : "±" + Math.round(s.genau) + "°" };
        if (bewegt < 5000) return { art: "warn", wert: "zu wenig geschwenkt", mess };
        return { art: "ok", wert: s.genau != null ? "±" + Math.round(s.genau) + "°" : "geschwenkt", mess };
      }
    },
    {
      id: "kompass-drehen", titel: "Kompass drehen", bezug: "läuft die Richtung mit?", block: "hand",
      kopf: "Handy einmal drehen", hand: "Leg das Handy flach vor dich und dreh es langsam einmal ganz herum. Die Kugel läuft mit, bis der Kreis orange ist.", grenze: 40,
      async lauf(ctx) {
        const s = ctx.sensor; s.faecher.clear();
        const t0 = jetzt();
        // jede Kompassmeldung mitschreiben (sensor.bei in geraete-test.html): [ms seit Los, Richtung in °, Gyro-Drehung seit Los in °, Genauigkeit in °]
        s.spur = { t0: performance.now(), w: [], letzte: null, max: 0, maxBei: null, ueber30: 0, neigMax: 0, neigSum: 0, neigN: 0,
          gyroN0: s.gyroN, achse0: [...s.gyroAchse], pfad0: [...s.gyroPfad], achse: null, hoch0: s.gyroHoch, hochN0: s.hochN };
        const gedreht = () => Math.abs(s.gyroDreh() || 0);
        // bis der Kreis voll ist (alle 36 Fächer), höchstens 30 s. Mit Gyroskop auch dann Schluss, wenn das Handy
        // laut Gyroskop mehr als eine Umdrehung hinter sich hat: dann kommt der Kompass nicht mehr nach.
        while (s.faecher.size < 36 && jetzt() - t0 < 30000 && !(s.gyroN > s.spur.gyroN0 && gedreht() >= 400)) { ctx.status(`${s.faecher.size} von 36`); await ctx.warte(150); }
        const n = s.faecher.size;
        ctx.status(`${n} von 36`);
        if (n >= 36) await ctx.warte(700);
        const gyroDa = s.gyroN > s.spur.gyroN0, gyroWeg = s.gyroDreh() || 0;
        const sp = s.spur; s.spur = null;
        const achsen = [0, 1, 2].map(i => Math.round(s.gyroAchse[i] - sp.achse0[i]));
        // Weg des Kompasses: Summe der Änderungen auf dem kürzesten Weg, mit Vorzeichen (im Uhrzeigersinn positiv)
        // dazu an jeder Stelle: wie weit liegt der Kompass (seit Los) gegen das Gyroskop (seit Los) daneben
        // Wandern ohne Drehung zählt sensor.bei mit (Gyroskop unter 8°/s), siehe geraete-test.html
        let kWeg = 0, abw = 0, abwBei = null, k0 = null;
        const wandert = sp.wandert || 0;
        for (let i = 1; i < sp.w.length; i++) {
          const dk = ((sp.w[i][1] - sp.w[i - 1][1]) % 360 + 540) % 360 - 180;
          kWeg += dk;
          const y = sp.w[i][2];
          if (y == null) continue;
          if (k0 == null) k0 = kWeg - y;   // Bezug beim ersten Wert mit Gyroskop
          const d = Math.abs(kWeg - k0 - y);
          if (d > abw) { abw = d; abwBei = sp.w[i][0]; }
        }
        const folgt = gyroDa && Math.abs(gyroWeg) >= 90 ? kWeg / gyroWeg : null;
        const dauer = (jetzt() - t0) / 1000;
        const mess = { "Richtungen gesehen": `${n} von 36`, "Quelle": s.quelle || "keine", "Dauer in s": rund(dauer, 1),
          "Meldungen": sp.w.length, "Meldungen pro Sekunde": rund(sp.w.length / Math.max(dauer, 0.1), 1),
          "Größter Sprung zwischen zwei Meldungen": Math.round(sp.max) + "°" + (sp.maxBei != null ? ` nach ${rund(sp.maxBei / 1000, 1)} s` : ""),
          "Sprünge über 30°": sp.ueber30,
          "Gyroskop": gyroDa ? "ja" : "keine Daten",
          "Laut Gyroskop gedreht": gyroDa ? Math.round(gyroWeg) + "°" : "–",
          "Gyro je Achse (alpha / beta / gamma)": gyroDa ? achsen.join("° / ") + "°" : "–",
          "Gyro-Achse der Drehung": gyroDa && sp.achse != null ? (sp.achse === "senkrecht" ? "senkrecht (nach Schwerkraft)" : ["alpha", "beta", "gamma"][sp.achse]) : "–",
          "Kompass mitgedreht": Math.round(kWeg) + "°",
          "Kompass folgt zu": folgt != null ? Math.round(folgt * 100) + " %" : "–",
          "Größte Abweichung Kompass gegen Gyroskop": k0 != null ? Math.round(abw) + "°" + (abwBei != null ? ` nach ${rund(abwBei / 1000, 1)} s` : "") : "–",
          "Kompass wandert ohne Drehung": gyroDa ? Math.round(wandert) + "°" : "–",
          "Neigung beim Drehen": sp.neigN ? `im Mittel ${Math.round(sp.neigSum / sp.neigN)}°, höchstens ${Math.round(sp.neigMax)}°` : "keine Daten" };
        // kompakt, damit 30 s bei voller Rate unter der Grenze des Servers (64 KB je Lauf) bleiben:
        // je Meldung "Abstand zur vorigen in ms,Richtung in 0,1°,Gyro-Drehung seit Los in °[,Genauigkeit in °]", getrennt durch ";"
        let vor = 0;
        const roh = { format: "dt_ms,grad_x10,gyro_grad[,genauigkeit_grad];...", daten: sp.w.map(([t, g, y, a]) => { const d = t - vor; vor = t; return d + "," + Math.round(g * 10) + "," + (y == null ? "" : y) + (a == null ? "" : "," + a); }).join(";") };
        if (s.quelle === "relativ" || !s.quelle) return { art: "err", wert: "kein Nordbezug", mess, roh };
        // Handy hat sich laut Gyroskop ganz gedreht, der Kompass kam nicht mit: Magnetfeld gestört oder nicht eingemessen
        if (gyroDa && Math.abs(gyroWeg) >= 330 && n < 30) {
          mess["Hinweis"] = `Das Handy hat sich laut Gyroskop um ${Math.round(Math.abs(gyroWeg))}° gedreht, der Kompass hat davon nur ${n} von 36 Richtungen gesehen. Häufige Gründe: Magnet in der Hülle oder Halterung, Metall in der Nähe, Kompass nicht eingemessen (Handy in einer Acht schwenken).`;
          return { art: "err", wert: "Kompass folgt nicht", mess, roh };
        }
        // Alle Richtungen gesehen, aber falsch gemessen: Weg oder Abweichung passen nicht zum Gyroskop
        // ab einer halben Umdrehung laut Gyroskop: ein gestreckter Kompass sieht alle 36 Richtungen schon vor der vollen Drehung
        if (folgt != null && Math.abs(gyroWeg) >= 180 && (Math.abs(folgt - 1) > 0.2 || abw > 30 || wandert > 30)) {
          mess["Hinweis"] = `Der Kompass dreht nicht gleichmäßig mit: laut Gyroskop ${Math.round(Math.abs(gyroWeg))}°, laut Kompass ${Math.round(Math.abs(kWeg))}°, unterwegs bis zu ${Math.round(abw)}° daneben${wandert > 30 ? `, im Stillliegen ${Math.round(wandert)}° gewandert` : ""}. Der Richtungspfeil zeigt dann um so viel falsch. Kompass einmessen (Handy in einer Acht schwenken), Magnete und Metall fernhalten.`;
          return { art: abw > 60 || Math.abs(folgt - 1) > 0.4 ? "err" : "warn", wert: `bis ${Math.round(abw)}° daneben`, mess, roh };
        }
        return { art: n >= 30 ? "ok" : n >= 12 ? "warn" : "err", wert: `${n} von 36`, mess, roh };
      }
    },
    {
      id: "bildschirm", titel: "Bildschirm aus und an", bezug: "kommt der Standort wieder?", block: "hand",
      kopf: "Handy sperren", hand: "Sperr das Handy, zähl bis zehn und entsperr es wieder. Die Seite wartet, bis du zurück bist.", grenze: 180,
      async lauf(ctx) {
        ctx.status("Jetzt sperren");
        const weg = await bisSichtbarWechsel(ctx, 120000);
        const mess = { "Bildschirm aus für s": rund(weg / 1000, 1) };
        const alt = ctx.wach.sperre;
        mess["Wake Lock beim Sperren freigegeben"] = alt ? janein(alt.released) : "war nicht gehalten";
        let neu = false;
        if (navigator.wakeLock) { try { ctx.wach.sperre = await navigator.wakeLock.request("screen"); neu = true; } catch (e) { mess["Wake Lock neu"] = e.name; } }
        mess["Wake Lock neu geholt"] = janein(neu);
        ctx.status("Warte auf Standort");
        const t = jetzt();
        try {
          const p = await standortEinmal(20000);
          const s = (jetzt() - t) / 1000;
          mess["Standort zurück nach s"] = rund(s, 1); mess["Genauigkeit in m"] = rund(p.coords.accuracy);
          return { art: s <= 5 && (neu || !navigator.wakeLock) ? "ok" : "warn", wert: "nach " + komma(s) + " s", mess };
        } catch (e) { mess["Standort"] = `Fehler ${e.code}: ${e.message}`; return { art: "err", wert: "kein Standort", mess }; }
      }
    },
    {
      id: "app-wechsel", titel: "App wechseln", bezug: "übersteht die Seite WhatsApp?", block: "hand",
      kopf: "Kurz in eine andere App", hand: "Wechsel kurz in eine andere App, zum Beispiel WhatsApp, und komm wieder her.", grenze: 180,
      async lauf(ctx) {
        ctx.status("Jetzt wechseln");
        const weg = await bisSichtbarWechsel(ctx, 120000);
        const t = jetzt(); let netz = true;
        try { await ctx.rpc("device_test_echo", { p_data: "" }); } catch { netz = false; }
        const mess = { "Weg für s": rund(weg / 1000, 1), "Server gleich wieder erreichbar": janein(netz), "Antwort in ms": Math.round(jetzt() - t),
          "Hinweis": "Lädt die Seite beim Zurückkommen neu, fehlt dieser Eintrag im Lauf." };
        return { art: netz ? "ok" : "warn", wert: netz ? "bleibt" : "Netz hängt", mess };
      }
    },

    {
      // Ein iPhone (iOS 18.7, kein Stromsparmodus) verweigerte die Sperre im automatischen Teil. Dieser Schritt
      // fragt sie direkt im Fingertipp an: klappt es so, braucht das Gerät den Tipp, und die App muss sie dort holen.
      // Seit Suite 8 läuft er von selbst: die Anfrage stellt der Tipp auf "Test starten" (ctx.wach.tippAnfrage).
      id: "wachhalten-tipp", titel: "Wach halten, mit Tipp", bezug: "braucht die Sperre einen Fingertipp?", block: "auto", selbst: true, grenze: 20,
      lauf(ctx) {
        const ohne = ctx.wach.ohneTipp || "nicht gelaufen";
        if (!navigator.wakeLock) return { art: "err", wert: "fehlt", mess: { "navigator.wakeLock": "nicht vorhanden", "Ohne Tipp": ohne } };
        const aktiv = ctx.wach.tippAktiv || (navigator.userActivation ? (navigator.userActivation.isActive ? "ja" : "nein") : "keine Angabe");
        const anfrage = ctx.wach.tippAnfrage || navigator.wakeLock.request("screen");
        return anfrage.then(l => {
          ctx.wach.sperre = l;
          const mess = { "Mit Tipp": "erteilt", "Ohne Tipp": ohne, "Tipp gilt noch (userActivation)": aktiv, "Seite sichtbar": document.visibilityState };
          if (ohne !== "erteilt") mess["Hinweis"] = "Dieses Gerät vergibt die Sperre nur direkt aus einem Fingertipp. Eine Seite muss sie beim Tippen holen.";
          return { art: "ok", wert: ohne === "erteilt" ? "erteilt" : "nur mit Tipp", mess };
        }, e => ({ art: "warn", wert: "auch mit Tipp verweigert", mess: { "Fehler": e.name + ": " + e.message, "Ohne Tipp": ohne,
          "Tipp gilt noch (userActivation)": aktiv, "Seite sichtbar": document.visibilityState,
          "Hinweis": "Auch direkt im Tipp verweigert: dann liegt es an einer Einstellung des Geräts oder des Browsers, nicht am Zeitpunkt." } }));
      }
    },

    /* ================= neue Funktionen ================= */
    {
      id: "kamera", titel: "Kamera und Foto", bezug: "für Fotos", block: "neu",
      kopf: "Ein Foto machen", hand: "Mach ein Foto von irgendetwas. Es geht nur darum, ob die Kamera aufgeht.", grenze: 180,
      lauf(ctx) {
        // Der Klick auf das Feld muss noch im Fingertipp passieren, darum kein async vor input.click()
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*"; input.capture = "environment";
        input.hidden = true; document.body.appendChild(input);   // iOS öffnet die Kamera nur für ein Feld, das im Dokument hängt
        const gewaehlt = new Promise((res, rej) => {
          input.onchange = () => input.files[0] ? res(input.files[0]) : rej(new Error("kein Foto"));
          input.oncancel = () => rej(new Error("abgebrochen"));
        });
        input.click();
        ctx.status("Wartet auf Foto");
        return (async () => {
          let datei;
          try { datei = await gewaehlt; } catch (e) { return { art: "err", wert: e.message, mess: {} }; }
          const mess = { "Aufnahme": `${rund(datei.size / 1048576, 1)} MB, ${datei.type || "Typ unbekannt"}` };
          let bild;
          try {
            bild = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("nicht lesbar")); i.src = URL.createObjectURL(datei); });
          } catch { mess["Bild"] = "der Browser kann das Format nicht lesen"; return { art: "err", wert: "nicht lesbar", mess }; }
          mess["Bildgröße"] = `${bild.naturalWidth} x ${bild.naturalHeight}`;
          const f = Math.min(1, 1600 / Math.max(bild.naturalWidth, bild.naturalHeight));
          const c = document.createElement("canvas"); c.width = Math.round(bild.naturalWidth * f); c.height = Math.round(bild.naturalHeight * f);
          c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
          URL.revokeObjectURL(bild.src);
          let url = c.toDataURL("image/jpeg", 0.8);
          if (url.length > 900000) url = c.toDataURL("image/jpeg", 0.5);
          mess["Verkleinert"] = `${c.width} x ${c.height}, ${Math.round(url.length * 0.75 / 1024)} KB`;
          if (ctx.feld) ctx.feld.innerHTML = `<img src="${url}" alt="" style="max-width:120px;border-radius:8px;margin-top:8px">`;
          ctx.status("Lädt hoch");
          const t = jetzt();
          try {
            await ctx.rpc("device_test_echo", { p_data: url.slice(0, 1000000) });
            const s = (jetzt() - t) / 1000; mess["Hochladen in s"] = rund(s, 1);
            return { art: s <= 5 ? "ok" : "warn", wert: komma(s) + " s Upload", mess };
          } catch (e) { mess["Hochladen"] = e.message; return { art: "warn", wert: "Foto ja, Upload nein", mess }; }
        })();
      }
    },
    {
      id: "vibration", titel: "Vibration", bezug: "Rückmeldung per Vibration", block: "neu",
      hand: "Das Handy vibriert gleich zweimal kurz.", frage: "Hast du es gespürt?",
      async lauf(ctx) {
        if (typeof navigator.vibrate !== "function") return { art: "err", wert: "fehlt", mess: { "navigator.vibrate": "nicht vorhanden, auf iPhones immer" } };
        const r = navigator.vibrate([200, 120, 200]);
        await ctx.warte(700);
        return r ? { art: "ok", wert: "gespürt", mess: { "navigator.vibrate": "ja", "Hinweis": "Android vibriert nicht im Stromsparmodus, bei Nicht stören oder wenn die Vibration in den Einstellungen aus ist." } } : { art: "err", wert: "verweigert", mess: { "navigator.vibrate": "gibt false zurück" } };
      }
    },
    {
      id: "benachrichtigung", titel: "Benachrichtigung", bezug: "Hinweis bei gesperrtem Handy", block: "neu",
      kopf: "Mitteilungen", hand: "Erlaube Mitteilungen, wenn das Handy fragt. Es kommt nur eine einzige Test-Mitteilung.",
      async lauf() {
        const mess = { "Notification": janein("Notification" in window), "Push": janein("PushManager" in window), "Service Worker": janein("serviceWorker" in navigator) };
        if (!("Notification" in window)) { mess["Hinweis"] = "Auf iPhones nur, wenn die Seite zum Home-Bildschirm hinzugefügt ist."; return { art: "err", wert: "fehlt", mess }; }
        let r;
        try { r = await Notification.requestPermission(); } catch (e) { mess["Fehler"] = e.message; return { art: "err", wert: "Fehler", mess }; }
        mess["Erlaubnis"] = r;
        if (r !== "granted") return { art: "warn", wert: r === "denied" ? "abgelehnt" : "offen", mess };
        try { new Notification("Geräte-Test", { body: "Diese Mitteilung ist der Test." }); mess["Direkt angezeigt"] = "ja"; return { art: "ok", wert: "erlaubt", mess }; }
        catch (e) { mess["Direkt angezeigt"] = "nein, braucht einen Service Worker"; return { art: "warn", wert: "nur mit Service Worker", mess }; }
      }
    },
    {
      id: "live", titel: "Live-Verbindung", bezug: "Änderungen sofort statt per Abfrage", block: "neu", selbst: true,
      lauf(ctx) {
        return new Promise(res => {
          if (!("WebSocket" in window)) return res({ art: "err", wert: "fehlt", mess: { "WebSocket": "nicht vorhanden" } });
          const url = ctx.cfg.url.replace(/^http/, "ws").replace(/\/$/, "") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(ctx.cfg.key) + "&vsn=1.0.0";
          const t0 = jetzt(); let offen = null, fertig = false, ws;
          const ende = e => { if (fertig) return; fertig = true; clearTimeout(aus); try { ws.close(); } catch { /* egal */ } res(e); };
          const aus = setTimeout(() => ende({ art: "err", wert: "keine Antwort", mess: { "Verbindung steht": janein(offen != null) } }), 8000);
          try { ws = new WebSocket(url); } catch (e) { return ende({ art: "err", wert: "Fehler", mess: { "Fehler": e.message } }); }
          ws.onopen = () => { offen = jetzt(); ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "1" })); };
          ws.onmessage = () => ende({ art: "ok", wert: Math.round(jetzt() - offen) + " ms", mess: { "Aufbau in ms": Math.round(offen - t0), "Antwort auf Herzschlag in ms": Math.round(jetzt() - offen) } });
          ws.onerror = () => ende({ art: "err", wert: "kommt nicht durch", mess: { "Verbindung steht": janein(offen != null) } });
        });
      }
    },
    {
      id: "offline", titel: "Offline", bezug: "Seite trägt im Funkloch", block: "neu", selbst: true,
      async lauf() {
        const sw = "serviceWorker" in navigator; let cache = false, grund = "";
        if ("caches" in window) {
          try {
            const c = await caches.open("gt-probe"), u = location.origin + location.pathname + "?cache-probe";
            await c.put(u, new Response("probe"));
            cache = (await (await c.match(u))?.text()) === "probe";
            await caches.delete("gt-probe");
          } catch (e) { grund = e.name + ": " + e.message; }
        }
        const mess = { "Service Worker": janein(sw), "Cache schreibt und liest": janein(cache), "Hinweis": "Es wurde nichts dauerhaft eingerichtet." };
        if (grund) mess["Fehler"] = grund;
        return { art: sw && cache ? "ok" : sw || cache ? "warn" : "err", wert: sw && cache ? "möglich" : "fehlt", mess };
      }
    }
  ];

  window.GT_TESTS = { version: 21, tests };   // 21: iPad mit mobiler Kennung ist ein Tablet (04.10.2026)   // 20: Akku als eigener Schritt (02.10.2026)   // 9: ohne "Kompass nach Pause"; 10: Kompass still liegend kein Fehler; 11: Drehen zeichnet jede Meldung auf; 12: Gyroskop und Neigung beim Drehen; 13: Gyro-Achse aus den Daten; 14: Abweichung Kompass gegen Gyroskop; 15: Drehung um die Senkrechte, auch schräg; 16: Einmessen vor dem Drehen; 17: Striche nur beim Drehen, Wandern ohne Drehung; 18: keine Position mehr; 19: neutrale Abfragen und Kennungen (02.10.2026)
})();

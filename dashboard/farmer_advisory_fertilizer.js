/* ===========================================================================
   farmer_advisory_fertilizer.js
   ---------------------------------------------------------------------------
   AUDIT_FIX_PROMPT.md item 10b: fills the Farmer Advisory panel's
   "Fertilizer & Crop Recommendation" card (previously a static "Select a
   village" placeholder, never wired to anything) with real, season-wise
   (Kharif/Rabi/Zayad) fertilizer guidance -- and, if the farmer has
   measured a field in Mera Khet, shows that field's real area alongside it.

   No structured N-P-K-per-crop database is built or invented here. This
   reuses the SAME Kisan Sahayak RAG pipeline (cloudflare/
   kisan_sahayak_worker.js's /chat endpoint) already answering section 7 of
   the Kisan Dashboard and mera_khet.js's own askAdvice() -- real retrieval
   over the real ICAR/state POP corpus, with the server's own
   buildCitationFooter() appended to every answer (never written by the
   model itself, never by this file). Three silent, non-chat-UI calls
   (one per season) are made and their streamed text is written straight
   into this card, instead of a chat bubble.

   Deliberately NOT done: multiplying a per-hectare dose the model returns
   by the farmer's measured area to print one final "kg for your field"
   number. Free-text extraction of a number out of an LLM answer is exactly
   the kind of silent, unverifiable step this repo's "no fabrication" rule
   exists to prevent -- a parsing bug there would produce a wrong number
   that LOOKS authoritative. Instead: the real measured area is shown as
   its own fact, the real per-hectare guidance is shown as its own fact,
   and the card tells the farmer to multiply the two themselves.
   ======================================================================== */
(function () {
  'use strict';

  var CHAT_URL = (window.VINDHYA_CONFIG && window.VINDHYA_CONFIG.CHAT_PROXY_URL)
    || 'https://vindhya-gemini-proxy.vindhyaresearch25.workers.dev';

  var SEASONS = [
    { key: 'kharif', en: 'Kharif (monsoon)', hi: 'खरीफ (मानसून)' },
    { key: 'rabi', en: 'Rabi (winter)', hi: 'रबी (सर्दी)' },
    { key: 'zayad', en: 'Zayad / summer', hi: 'ज़ायद / गर्मी' }
  ];

  var _seq = 0; // guards a slow earlier context's answers from overwriting a newer selection

  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    // Real LLM generation, not a data-file fetch -- longer budget than this
    // repo's usual 30s data-fetch timeout, still bounded (STANDING ORDERS #5).
    var timer = controller ? setTimeout(function () { controller.abort(); }, 45000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function renderEmpty() {
    var body = document.getElementById('adv-body-5');
    if (body) body.innerHTML = '<div>' + t(
      'Select a district or village, or draw your field in Mera Khet, to see season-wise fertilizer recommendations.',
      'ज़िला/गाँव चुनें, या Mera Khet में अपना खेत बनाएं, ताकि मौसम-वार खाद सिफारिश दिखे।'
    ) + '</div>';
    var titleEl = document.getElementById('adv-title-5');
    if (titleEl) titleEl.textContent = t('Fertilizer & Crop Recommendation', 'खाद एवं फसल सिफारिश');
  }

  function renderLoading(ctx) {
    var titleEl = document.getElementById('adv-title-5');
    if (titleEl) titleEl.textContent = t('Fertilizer & Crop Recommendation', 'खाद एवं फसल सिफारिश') + ' — ' + (ctx.districtName || '');
    var body = document.getElementById('adv-body-5');
    if (!body) return;
    var html = '';
    if (ctx.areaHa) {
      html += '<div class="fert-area-note"><i class="fa fa-draw-polygon"></i> ' +
        t('Your measured field (Mera Khet): ', 'आपका नापा गया खेत (Mera Khet): ') +
        '<b>' + ctx.areaHa.toFixed(2) + ' ' + t('hectares', 'हेक्टेयर') + '</b>. ' +
        t('Doses below are per hectare — multiply by your area for your whole field.',
          'नीचे दी गई मात्रा प्रति हेक्टेयर है — अपने पूरे खेत के लिए अपने क्षेत्रफल से गुणा करें।') +
        '</div>';
    }
    SEASONS.forEach(function (s) {
      html += '<div class="fert-season-block"><div class="fert-season-title">' + t(s.en, s.hi) + '</div>' +
        '<div class="fert-season-body" id="fert-body-' + s.key + '"><i class="fa fa-spinner fa-spin"></i> ' +
        t('Loading real recommendation from Kisan Sahayak…', 'किसान सहायक से असली सिफारिश लाई जा रही है…') + '</div></div>';
    });
    body.innerHTML = html;
  }

  // Both accumulate real "response" token frames AND surface a real
  // server-sent "error" frame (e.g. the Workers AI daily-quota message)
  // instead of silently discarding it -- an empty answer from a real
  // upstream error must not be reported as "no response", per this
  // repo's standing rule that a genuine failure is always shown honestly.
  function consumeFrame(frame, state) {
    if (!frame || frame.done || !frame.obj) return;
    if (typeof frame.obj.response === 'string') state.out += frame.obj.response;
    else if (frame.obj.type === 'error' && frame.obj.message) state.err = frame.obj.message;
  }

  function parseSseText(text) {
    var state = { out: '', err: null };
    text.split('\n\n').forEach(function (line) {
      consumeFrame((typeof window.parseSseFrame === 'function') ? window.parseSseFrame(line) : null, state);
    });
    if (!state.out && state.err) throw new Error(state.err);
    return state.out;
  }

  function readSseStream(reader) {
    var decoder = new TextDecoder();
    var buf = '';
    var state = { out: '', err: null };
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) {
          if (!state.out && state.err) throw new Error(state.err);
          return state.out;
        }
        buf += decoder.decode(res.value, { stream: true });
        var parts = buf.split('\n\n');
        buf = parts.pop();
        parts.forEach(function (p) {
          consumeFrame((typeof window.parseSseFrame === 'function') ? window.parseSseFrame(p) : null, state);
        });
        return pump();
      });
    }
    return pump();
  }

  function askOne(season, ctx) {
    var lang = isHindi() ? 'hi' : 'en';
    var place = {
      state: ctx.stateName || null, district: ctx.districtName || null, village: null,
      lat: ctx.lat != null ? ctx.lat : null, lon: ctx.lon != null ? ctx.lon : null
    };
    var message = (lang === 'hi'
      ? (season.hi + ' मौसम में इस इलाके की मुख्य फसल के लिए ICAR/राज्य कृषि विभाग की अनुशंसित NPK खाद की मात्रा (किलोग्राम/हेक्टेयर) क्या है? संक्षेप में बताएं।')
      : ('What is the ICAR / state agriculture department recommended NPK fertilizer dose (kg/ha) for the main crop grown in the ' + season.en + ' season in this area? Answer briefly.')
    );
    return fetchWithTimeout(CHAT_URL.replace(/\/$/, '') + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, history: [], place: place, lang: lang, client_context: '' })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('text/event-stream') === -1 || !r.body || !r.body.getReader) {
        return r.text().then(parseSseText);
      }
      return readSseStream(r.body.getReader());
    });
  }

  // ctx: {districtName, stateName, areaHa (optional), lat, lon}
  function load(ctx) {
    var mySeq = ++_seq;
    if (!ctx || !ctx.districtName) { renderEmpty(); return; }
    renderLoading(ctx);
    SEASONS.forEach(function (s) {
      askOne(s, ctx).then(function (text) {
        if (mySeq !== _seq) return; // a newer selection has already superseded this one
        var el = document.getElementById('fert-body-' + s.key);
        if (!el) return;
        var trimmed = (text || '').trim();
        el.textContent = trimmed || t('No response received — try again.', 'कोई जवाब नहीं मिला — फिर कोशिश करें।');
      }).catch(function (e) {
        if (mySeq !== _seq) return;
        var el = document.getElementById('fert-body-' + s.key);
        if (el) el.innerHTML = '<span style="color:#c0392b">' +
          t('Failed to load: ', 'लोड नहीं हुआ: ') + esc(e && e.message || '') + '</span>';
      });
    });
  }

  window.VindhyaFertilizerAdvisory = { load: load };
})();

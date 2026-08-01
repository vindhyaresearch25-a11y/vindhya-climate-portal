/*
 * knowledge_base_loader.js — VINDHYA Climate Portal
 *
 * Loads data/knowledge_base/index.json (government portal pointers + a small
 * set of real open-access research papers, see dashboard/data/knowledge_base/
 * README.md) and exposes window.buildKnowledgeBaseContext(question), used by
 * the chatbot's system prompt (index.html, buildChatSystemPrompt) to ground
 * answers in cited sources instead of invented facts.
 *
 * This is plain keyword-overlap retrieval, not a vector index -- adequate for
 * a manifest of a few dozen entries served from a static site with no backend.
 */
(function () {
  'use strict';
  var KB_URL = 'data/knowledge_base/index.json';
  var state = { entries: [], loaded: false };

  function tokenize(s) {
    return (s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }

  var STOPWORDS = {the:1,a:1,an:1,of:1,and:1,or:1,in:1,for:1,to:1,is:1,are:1,what:1,how:1,my:1,me:1,i:1,do:1,can:1,does:1};

  function score(queryTokens, entry) {
    var text = [entry.title, entry.summary, entry.category].join(' ');
    var entryTokens = tokenize(text);
    var set = {};
    entryTokens.forEach(function (t) { set[t] = 1; });
    var s = 0;
    queryTokens.forEach(function (t) {
      if (STOPWORDS[t]) return;
      if (set[t]) s++;
    });
    return s;
  }

  function buildKnowledgeBaseContext(question) {
    if (!state.loaded || !state.entries.length) return '';
    var qTokens = tokenize(question);
    if (!qTokens.length) return '';
    var scored = state.entries
      .map(function (e) { return { e: e, s: score(qTokens, e) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 3);
    if (!scored.length) return '';

    var lines = ['Knowledge-base references (cite these when relevant; do not present them as more certain than their license/status allows):'];
    scored.forEach(function (x) {
      var e = x.e;
      lines.push('- "' + e.title + '" (' + (e.year || 'n.d.') + ', ' + e.source + ', ' + e.license + '): '
        + e.summary + ' Link: ' + e.source_url);
    });
    lines.push('If the farmer\'s question is location-specific and none of the above is a direct match, say the information is not in the knowledge base and suggest they contact their nearest Krishi Vigyan Kendra (KVK) -- locator: https://kvk.icar.gov.in/ -- or the relevant portal above.');
    return lines.join('\n');
  }

  function init() {
    fetch(KB_URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.entries)) {
          state.entries = data.entries;
          state.loaded = true;
        }
      })
      .catch(function (e) { console.warn('[knowledge_base_loader] failed to load manifest:', e); });
  }

  window.buildKnowledgeBaseContext = buildKnowledgeBaseContext;
  init();
})();

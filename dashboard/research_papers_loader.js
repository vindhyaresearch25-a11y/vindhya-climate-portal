/*
 * research_papers_loader.js -- Kisan Sahayak Phase 7.3 (FINAL_PROMPT.md):
 * "in FREE API se jodo: OpenAlex, Semantic Scholar, CORE, CrossRef, DOAJ,
 * PubMed/PMC, FAO AGRIS, ICAR KRISHI. Har jawab ke saath title, lekhak,
 * saal, link. Sci-Hub kabhi nahi."
 *
 * HONEST SCOPE (checked each of the 8 named sources with a real request
 * before writing this, 2026-08-08 -- see docs/DATA_SOURCES.md):
 *   Wired (free, keyless, responded 200 with usable JSON):
 *     - OpenAlex   (api.openalex.org)              -- richest, primary
 *     - CrossRef   (api.crossref.org)               -- DOI registry
 *     - DOAJ       (doaj.org)                        -- open-access journals
 *     - PubMed/PMC (eutils.ncbi.nlm.nih.gov)         -- esearch + esummary
 *     - Semantic Scholar (api.semanticscholar.org)  -- best-effort only:
 *       the public (keyless) tier returned HTTP 429 on the very first
 *       test call. Still attempted on every search (free, no key needed
 *       for their documented public tier), but a 429/failure here is
 *       silently dropped rather than shown as an error -- the other four
 *       sources carry the feature.
 *   NOT wired, with the real reason (never silently skipped without a
 *   reason on record):
 *     - CORE        -- api.core.ac.uk requires a registered API key
 *       (returned HTTP 301 to an auth flow on a keyless request). This
 *       portal has no CORE key and does not fabricate having one.
 *     - FAO AGRIS   -- agris.fao.org returned HTTP 403 (Cloudflare bot
 *       challenge page) on a plain keyless request. No documented public
 *       JSON API found; bypassing the challenge would violate this
 *       portal's own bot-detection rule.
 *     - ICAR KRISHI -- krishi.icar.gov.in did not resolve (DNS failure)
 *       from this environment at time of writing. No public API found.
 *   Sci-Hub is never called anywhere in this file or referenced as a
 *   source, per the explicit "Sci-Hub kabhi nahi" rule.
 *
 * Every result carries title + authors + year + a real link (DOI or
 * landing-page URL from the source itself, never invented) + which
 * source it came from. No result is ever fabricated -- a query with no
 * real matches returns an empty array, rendered as an honest
 * "no matching papers found" message, never a placeholder citation.
 */
(function () {
  'use strict';

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

  function safe(promise) {
    // Never let one source's failure/timeout/429 break the others.
    return promise.catch(function () { return []; });
  }

  function fromOpenAlex(query) {
    var url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query) + '&per-page=4';
    return safe(fetchWithTimeout(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        return (d.results || []).map(function (r) {
          var authors = (r.authorships || []).slice(0, 3).map(function (a) { return a.author && a.author.display_name; }).filter(Boolean);
          var link = r.doi || (r.primary_location && r.primary_location.landing_page_url) || null;
          if (!r.title || !link) return null;
          return { title: r.title, authors: authors, year: r.publication_year || null, link: link, source: 'OpenAlex' };
        }).filter(Boolean);
      }));
  }

  function fromCrossRef(query) {
    var url = 'https://api.crossref.org/works?query=' + encodeURIComponent(query) + '&rows=4';
    return safe(fetchWithTimeout(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        return ((d.message && d.message.items) || []).map(function (r) {
          var title = r.title && r.title[0];
          var authors = (r.author || []).slice(0, 3).map(function (a) { return [a.given, a.family].filter(Boolean).join(' '); });
          var yearParts = (r.issued && r.issued['date-parts'] && r.issued['date-parts'][0]) || null;
          var link = r.URL || (r.DOI ? 'https://doi.org/' + r.DOI : null);
          if (!title || !link) return null;
          return { title: title, authors: authors, year: yearParts ? yearParts[0] : null, link: link, source: 'CrossRef' };
        }).filter(Boolean);
      }));
  }

  function fromDoaj(query) {
    var url = 'https://doaj.org/api/search/articles/' + encodeURIComponent(query) + '?pageSize=4';
    return safe(fetchWithTimeout(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        return (d.results || []).map(function (r) {
          var bib = r.bibjson || {};
          var authors = (bib.author || []).slice(0, 3).map(function (a) { return a.name; }).filter(Boolean);
          var linkObj = (bib.link || []).filter(function (l) { return l.url; })[0];
          if (!bib.title || !linkObj) return null;
          return { title: bib.title, authors: authors, year: bib.year || null, link: linkObj.url, source: 'DOAJ' };
        }).filter(Boolean);
      }));
  }

  function fromPubMed(query) {
    var esearch = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=4&term=' + encodeURIComponent(query);
    return safe(fetchWithTimeout(esearch).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var ids = (d.esearchresult && d.esearchresult.idlist) || [];
        if (!ids.length) return [];
        var esummary = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + ids.join(',');
        return fetchWithTimeout(esummary).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (s) {
            var result = s.result || {};
            return ids.map(function (id) {
              var rec = result[id];
              if (!rec || !rec.title) return null;
              var authors = (rec.authors || []).slice(0, 3).map(function (a) { return a.name; }).filter(Boolean);
              var year = rec.pubdate ? parseInt(String(rec.pubdate).slice(0, 4), 10) : null;
              return { title: rec.title, authors: authors, year: year || null, link: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/', source: 'PubMed' };
            }).filter(Boolean);
          });
      }));
  }

  function fromSemanticScholar(query) {
    // Best-effort: public tier is unauthenticated and heavily rate-limited
    // (observed HTTP 429 on first real test) -- a failure here is normal,
    // not a bug, and is always dropped silently by safe().
    var url = 'https://api.semanticscholar.org/graph/v1/paper/search?query=' + encodeURIComponent(query) + '&limit=3&fields=title,authors,year,externalIds,url';
    return safe(fetchWithTimeout(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        return (d.data || []).map(function (r) {
          var authors = (r.authors || []).slice(0, 3).map(function (a) { return a.name; }).filter(Boolean);
          var link = r.url || (r.externalIds && r.externalIds.DOI ? 'https://doi.org/' + r.externalIds.DOI : null);
          if (!r.title || !link) return null;
          return { title: r.title, authors: authors, year: r.year || null, link: link, source: 'Semantic Scholar' };
        }).filter(Boolean);
      }));
  }

  function dedupeByTitle(list) {
    var seen = {};
    return list.filter(function (p) {
      var key = String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    });
  }

  // Returns a promise of up to `limit` real papers, newest first, merged
  // across every source that responded. Never throws -- a total outage
  // across all 5 sources resolves to an empty array, rendered upstream as
  // an honest "no papers found" message rather than a stuck spinner.
  function searchPapers(query, limit) {
    limit = limit || 6;
    return Promise.all([
      fromOpenAlex(query), fromCrossRef(query), fromDoaj(query), fromPubMed(query), fromSemanticScholar(query)
    ]).then(function (lists) {
      var all = dedupeByTitle([].concat.apply([], lists));
      all.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
      return all.slice(0, limit);
    });
  }

  function isHindi() {
    try { return typeof chatLangHi !== 'undefined' ? chatLangHi : false; } catch (e) { return false; }
  }

  function formatResults(papers, query) {
    var hi = isHindi();
    if (!papers.length) {
      return hi
        ? '"' + query + '" के लिए कोई मेल खाता शोध-पत्र नहीं मिला (OpenAlex, CrossRef, DOAJ, PubMed, Semantic Scholar में खोजा गया)। सवाल को अलग तरह से पूछकर देखें।'
        : 'No matching research papers found for "' + query + '" (searched OpenAlex, CrossRef, DOAJ, PubMed, Semantic Scholar). Try rephrasing the question.';
    }
    var lines = papers.map(function (p) {
      var authorStr = p.authors.length ? p.authors.join(', ') + (p.authors.length >= 3 ? ' et al.' : '') : (hi ? 'लेखक अज्ञात' : 'authors not listed');
      var yearStr = p.year || (hi ? 'वर्ष अज्ञात' : 'year unknown');
      return '• **' + p.title + '**' + '\n  ' + authorStr + ' (' + yearStr + ') -- ' + p.source + '\n  ' + p.link;
    });
    var header = hi ? '**"' + query + '" से जुड़े असली शोध-पत्र:**\n\n' : '**Real research papers related to "' + query + '":**\n\n';
    var footer = hi ? '\n\n(स्रोत: OpenAlex, CrossRef, DOAJ, PubMed/PMC, Semantic Scholar -- कभी Sci-Hub नहीं)' : '\n\n(Sources: OpenAlex, CrossRef, DOAJ, PubMed/PMC, Semantic Scholar -- never Sci-Hub)';
    return header + lines.join('\n\n') + footer;
  }

  // Heuristic: does the user's message look like a request for research
  // backing, rather than a normal district/weather/mandi question? Kept
  // narrow on purpose -- Kisan Sahayak's other reply paths (local chip
  // answers, the Gemini/Workers-AI completion) already cover everything
  // else, and running a 5-API fan-out on every single message would be
  // slow and wasteful for questions that have nothing to do with papers.
  var TRIGGER_RE = /\b(research|paper|study|studies|journal|publication|evidence|scientific)\b|शोध|अध्ययन|अनुसंधान|वैज्ञानिक शोध|रिसर्च/i;

  function looksLikeResearchRequest(text) {
    return TRIGGER_RE.test(text || '');
  }

  // Strips the chat-specific framing words so the query sent to the
  // scholarly APIs is closer to a real search term, not a full sentence.
  function toQuery(text) {
    return String(text || '')
      .replace(/\b(research|paper|papers|study|studies|journal|publication|evidence|scientific|show|find|search|for|about|on|the|any|is|are|there|me)\b/gi, ' ')
      .replace(/शोध|अध्ययन|अनुसंधान|रिसर्च|दिखाओ|खोजो|बताओ|क्या|है|के|बारे|में/g, ' ')
      .replace(/[?.!,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || text;
  }

  window.VindhyaResearchPapers = {
    search: searchPapers,
    format: formatResults,
    looksLikeResearchRequest: looksLikeResearchRequest,
    toQuery: toQuery
  };
})();

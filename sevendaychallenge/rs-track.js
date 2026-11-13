/*
 * RevStream first-party tracking -> Supabase (project: revstream-tracking)
 *
 * Load in <head>:  <script src="rs-track.js" data-page="challenge"></script>
 * The key below is the PUBLIC publishable key. The database only allows this key
 * to INSERT rows into public.events — it cannot read, change or delete anything.
 *
 * Manual events from other scripts:  window.rsTrack('popup_open', { section: 'hero' })
 * Visitor id (for passing into forms): window.rsVisitorId
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://caynjmuowaqmaustlvew.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_Zovg9GomRRAE62rwJmQf9w_XCMarKSf';

  var script = document.currentScript;
  var PAGE = (script && script.getAttribute('data-page')) || 'challenge';

  // ---------- safe storage helpers ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function cut(v, n) { return v == null || v === '' ? null : String(v).slice(0, n); }

  // ---------- identity ----------
  var visitorId = lsGet('rs_vid');
  if (!/^[0-9a-f-]{36}$/i.test(visitorId || '')) { visitorId = uuid(); lsSet('rs_vid', visitorId); }
  var sessionId = ssGet('rs_sid');
  if (!/^[0-9a-f-]{36}$/i.test(sessionId || '')) { sessionId = uuid(); ssSet('rs_sid', sessionId); }
  window.rsVisitorId = visitorId;

  // ---------- attribution ----------
  var qs = new URLSearchParams(location.search);
  var extRef = '';
  try {
    if (document.referrer && new URL(document.referrer).host !== location.host) extRef = document.referrer;
  } catch (e) {}

  // last touch = how this session arrived (kept for the whole session)
  var lt = null;
  try { lt = JSON.parse(ssGet('rs_lt') || 'null'); } catch (e) {}
  if (!lt) {
    lt = {
      utm_source: qs.get('utm_source'), utm_medium: qs.get('utm_medium'),
      utm_campaign: qs.get('utm_campaign'), utm_content: qs.get('utm_content'),
      utm_term: qs.get('utm_term'), fbclid: qs.get('fbclid'),
      referrer: extRef || null, landing_url: location.href
    };
    ssSet('rs_lt', JSON.stringify(lt));
  }

  // first touch = how this visitor arrived the very first time (kept forever)
  var ft = null;
  try { ft = JSON.parse(lsGet('rs_ft') || 'null'); } catch (e) {}
  if (!ft) {
    ft = {
      source: lt.utm_source || (lt.fbclid ? 'facebook' : null),
      medium: lt.utm_medium, campaign: lt.utm_campaign, content: lt.utm_content,
      referrer: lt.referrer, at: new Date().toISOString()
    };
    lsSet('rs_ft', JSON.stringify(ft));
  }

  var w = window.innerWidth || 1024;
  var device = w < 768 ? 'mobile' : (w < 1024 ? 'tablet' : 'desktop');
  var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

  // ---------- sending ----------
  var queue = [];
  var timer = null;
  var ENDPOINT = SUPABASE_URL + '/rest/v1/events';

  function flush(useKeepalive) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        keepalive: !!useKeepalive,
        headers: {
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(batch)
      }).catch(function () {});
    } catch (e) {}
  }

  function track(event, props) {
    props = props || {};
    try {
      queue.push({
        visitor_id: visitorId, session_id: sessionId, event: event, page: PAGE,
        section: cut(props.section, 60), label: cut(props.label, 200),
        value: typeof props.value === 'number' && isFinite(props.value) ? Math.max(0, Math.min(100000, Math.round(props.value))) : null,
        utm_source: cut(lt.utm_source, 200), utm_medium: cut(lt.utm_medium, 200),
        utm_campaign: cut(lt.utm_campaign, 300), utm_content: cut(lt.utm_content, 300),
        utm_term: cut(lt.utm_term, 300), fbclid: cut(lt.fbclid, 500),
        referrer: cut(lt.referrer, 500), landing_url: cut(lt.landing_url, 1000),
        ft_source: cut(ft.source, 200), ft_medium: cut(ft.medium, 200),
        ft_campaign: cut(ft.campaign, 300), ft_content: cut(ft.content, 300),
        ft_referrer: cut(ft.referrer, 500), ft_at: ft.at || null,
        device: device, screen_w: w, lang: cut(navigator.language, 20), tz: cut(tz, 60)
      });
      if (queue.length >= 20) flush(false);
      else if (!timer) timer = setTimeout(function () { flush(false); }, 1500);
    } catch (e) {}
  }
  window.rsTrack = track;

  // ---------- engagement time + leave ----------
  var visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  var engagedMs = 0;
  var maxScroll = 0;
  var leaveSent = false;
  function sendLeave() {
    if (leaveSent) return;
    leaveSent = true;
    if (visibleSince) { engagedMs += Date.now() - visibleSince; visibleSince = null; }
    track('page_leave', { value: Math.round(engagedMs / 1000), label: 'max_scroll_' + maxScroll });
    flush(true);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (visibleSince) { engagedMs += Date.now() - visibleSince; visibleSince = null; }
      flush(true);
    } else {
      visibleSince = Date.now();
    }
  });
  window.addEventListener('pagehide', sendLeave);

  // ---------- page-specific tracking ----------
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    if (PAGE === 'thank_you') {
      track('thank_you_view');
      return;
    }

    track('page_view');

    // section views (each section once per page view)
    if ('IntersectionObserver' in window) {
      var seen = {};
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var id = en.target.id;
          if (en.isIntersecting && !seen[id]) { seen[id] = true; track('section_view', { section: id }); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -40% 0px', threshold: 0 });
      document.querySelectorAll('section[id]').forEach(function (s) { io.observe(s); });
    }

    // scroll depth 25 / 50 / 75 / 100
    var marks = [25, 50, 75, 100];
    var sent = {};
    function onScroll() {
      var doc = document.documentElement;
      var h = doc.scrollHeight - window.innerHeight;
      var pct = h > 0 ? Math.round(100 * (window.scrollY || doc.scrollTop) / h) : 100;
      if (pct > maxScroll) maxScroll = Math.min(100, pct);
      marks.forEach(function (m) {
        if (!sent[m] && pct >= m - 1) { sent[m] = true; track('scroll_depth', { value: m }); }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // clicks: sign-up buttons, testimonial videos, other links
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href === '#apply') {
        var sec = a.closest('#sticky-cta') ? 'sticky' : ((a.closest('section[id]') || {}).id || 'other');
        track('cta_click', { section: sec, label: (a.textContent || '').replace(/\s+/g, ' ').trim() });
        return;
      }
      if (/youtube\.com|youtu\.be|results\.revstreamconsortium\.com/.test(href)) {
        var card = a.closest('.t-card');
        var name = card && card.querySelector('.t-name') ? card.querySelector('.t-name').textContent.trim() : '';
        var sec2 = (a.closest('section[id]') || {}).id || 'other';
        track('video_click', { section: sec2, label: (name ? name + ' · ' : '') + href });
        return;
      }
      if (/^https?:/.test(href)) {
        track('link_click', { section: (a.closest('section[id]') || {}).id || 'other', label: href });
      }
    }, true);
  });
})();

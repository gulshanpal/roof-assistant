/*!
 * ============================================================================
 *  Roof Assistant — AI Receptionist Chat Widget                      v2.2.0
 * ============================================================================
 *
 *  EMBED SNIPPET (the client pastes this just before </body>):
 *
 *    <script src="https://YOUR-SITE.pages.dev/chat-widget.js"
 *            data-client-id="sunshine-roofing-orlando"
 *            async></script>
 *
 *  Optional attributes:
 *    data-config-url  Override where server-config.json lives
 *    data-api-url     Override where the AI endpoint lives (default /api/chat)
 *    data-debug="true" Verbose console logging
 *    data-color="#ea580c"  Force a colour ("auto" = match the website theme)
 *
 *  HOW IT WORKS
 *    - The visitor can tap quick-reply buttons OR type anything.
 *    - Typed messages are answered by the AI receptionist (functions/api/chat.js).
 *    - The IMPORTANT rules are enforced here in code, not left to the AI:
 *        • a tenant/renter answer always ends the chat,
 *        • ZIP, phone and email are checked with strict patterns,
 *        • the lead is sent the moment owner + ZIP + phone + email are known.
 *    - If the AI is switched off, slow, out of free quota or errors, the widget
 *      silently continues with a scripted step-by-step flow, so leads are
 *      never lost.
 *    - Leads go to the client's webhook and/or email. Nothing is stored by you.
 *
 *  DEBUG (browser console): RoofAssistant.open() / .close() / .reset() / .state()
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var WIDGET_VERSION = '2.2.0';

  /* ==========================================================================
   * 1. FIND OUR <script> TAG AND READ ITS ATTRIBUTES
   * ======================================================================== */
  var scriptTag = document.currentScript || (function () {
    var tags = document.querySelectorAll('script[data-client-id]');
    return tags.length ? tags[tags.length - 1] : null;
  })();
  if (!scriptTag) { console.warn('[RoofAssistant] Could not find the widget <script> tag.'); return; }

  var CLIENT_ID = (scriptTag.getAttribute('data-client-id') || '').trim();
  var DEBUG = scriptTag.getAttribute('data-debug') === 'true';
  // Optional colour override on the script tag: data-color="#ea580c" or "auto".
  var COLOR_OVERRIDE = (scriptTag.getAttribute('data-color') || '').trim();
  var BASE_URL = scriptTag.src || window.location.href;
  var CONFIG_URL = scriptTag.getAttribute('data-config-url') || new URL('server-config.json', BASE_URL).href;
  var API_URL = scriptTag.getAttribute('data-api-url') || new URL('/api/chat', BASE_URL).href;

  if (!CLIENT_ID) { console.warn('[RoofAssistant] Missing data-client-id.'); return; }
  if (window.RoofAssistant && window.RoofAssistant.version) return; // pasted twice
  window.RoofAssistant = { version: WIDGET_VERSION, clientId: CLIENT_ID };


  /* ==========================================================================
   * 2. CONSTANTS
   * ======================================================================== */
  var STEP = { INIT: 'init', CHAT: 'chat', DONE: 'done', CLOSED: 'closed' };

  var DEFAULT_SERVICES = ['🔴 Emergency Leak Repair', '🔨 Full Roof Replacement', '⛈️ Storm Damage Estimate'];
  var OWNER_YES = 'Yes, I own it';
  var OWNER_NO = "No, I'm renting";
  var MAX_INPUT = 500;
  var AI_TIMEOUT_MS = 18000;

  var ICONS = {
    chat:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    send:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>'
  };

  var REGION_HINTS = {
    US: { placeholder: 'Type your message…' },
    UK: { placeholder: 'Type your message…' }
  };


  /* ==========================================================================
   * 3. SCRIPTED MESSAGES (used for fixed moments and as the AI fallback)
   * ======================================================================== */
  function buildCopy(cfg) {
    return {
      greeting:  cfg.greeting || ('Hi there! Welcome to the ' + cfg.company_name + ' 24/7 Roof Assistant. 🏠 Do you need an Emergency Leak Repair, a Full Roof Replacement, or a Storm Damage Estimate?'),
      pickService: 'I can help with that. Which of these best describes what you need?',
      ownership: 'Got it. Our crews prioritize urgent requests. To route this correctly, do you own this property?',
      ownershipAgain: 'Just to confirm before we continue: do you own this property?',
      notOwner:  'Thanks for letting us know. The property owner will need to contact us directly so we can authorize repairs. Thank you!',
      zip:       'Perfect. What is the ZIP code of the property so I can check our current crew availability?',
      zipAgain:  "Sorry, I didn't catch that. What is the property's ZIP code?",
      contact:   'Great news! We have a project manager near your area. What is the best phone number and email to send your estimate or call you right back?',
      needPhone: 'Thanks! What is the best phone number to reach you?',
      needEmail: 'Got it. And what is the best email address for your estimate?',
      price:     'Every roof is unique, which is why our manager will give you an exact, free estimate as soon as we review your details.',
      closing:   'Thank you! Your details have been sent directly to our team. A specialist will call you shortly.',
      doneNote:  '✓ Request received. Keep your phone nearby.',
      closedNote:'This conversation has ended.'
    };
  }


  /* ==========================================================================
   * 4. UTILITIES
   * ======================================================================== */
  function log() {
    if (DEBUG) console.log.apply(console, ['[RoofAssistant]'].concat([].slice.call(arguments)));
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // DOM builder. `text` uses textContent, so user input can never inject HTML.
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function normalizeHex(value, fallback) {
    var v = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : fallback;
  }
  function hexToRgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function adjustColor(hex, amt) {
    return '#' + hexToRgb(hex).map(function (c) {
      var v = amt < 0 ? c * (1 + amt) : c + (255 - c) * amt;
      return ('0' + Math.round(v).toString(16)).slice(-2);
    }).join('');
  }
  function hexToRgba(hex, a) { return 'rgba(' + hexToRgb(hex).join(',') + ',' + a + ')'; }
  // WCAG luminance → white or dark text, so any brand colour stays readable.
  function readableTextColor(hex) {
    var l = hexToRgb(hex).map(function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    var L = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    // White text whenever it's clearly readable (contrast >= 3:1, like most brand
    // buttons); dark text only on light colours such as yellow or light blue.
    return (1.05 / (L + 0.05)) >= 3 ? '#ffffff' : '#111827';
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).filter(function (w) { return /^[a-z0-9]/i.test(w); })
      .slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') || '?';
  }
  function stripEmoji(label) { return String(label).replace(/^[^A-Za-z0-9]+/, '').trim(); }

  function isDomainAllowed(allowed) {
    var host = (window.location.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!host || host === 'localhost' || host === '127.0.0.1' || /\.local$/.test(host)) return true;
    if (host === new URL(BASE_URL).hostname.toLowerCase()) return true; // our own demo page
    if (!allowed || !allowed.length) return true;
    return allowed.some(function (d) {
      d = String(d).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/:].*$/, '');
      return host === d || host.slice(-(d.length + 1)) === '.' + d;
    });
  }
  function isSmallScreen() { return window.matchMedia && window.matchMedia('(max-width: 480px)').matches; }

  /* ---------------- Detail extraction & validation --------------------------
   * These run on every typed message, so the important details are captured
   * reliably even if the AI misses them or is unavailable.
   * ------------------------------------------------------------------------ */
  var RE_EMAIL = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  var RE_PHONE = /(\+?\(?\d[\d\s().\-]{6,18}\d)/;
  var RE_US_ZIP = /\b\d{5}(?:-\d{4})?\b/;
  var RE_UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

  function validEmail(v) { return !!v && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function validPhone(v) {
    if (!v || !/^[+\d\s().\-]+$/.test(v)) return false;
    var digits = v.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }
  function validZip(v, region) {
    if (!v) return false;
    v = String(v).trim();
    return region === 'UK' ? /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(v) : /^\d{5}(-\d{4})?$/.test(v);
  }

  // Pull email, phone and ZIP out of free text, in that order, so the digits of
  // a phone number are never mistaken for a ZIP code.
  function extractDetails(text, region) {
    var found = {};
    var rest = String(text);
    var m = rest.match(RE_EMAIL);
    if (m) { found.email = m[0].toLowerCase(); rest = rest.replace(m[0], ' '); }
    m = rest.match(RE_PHONE);
    if (m && validPhone(m[1].trim())) { found.phone = m[1].trim(); rest = rest.replace(m[1], ' '); }
    m = rest.match(region === 'UK' ? RE_UK_POSTCODE : RE_US_ZIP);
    if (m) found.zip = m[0].toUpperCase();
    return found;
  }

  // Keyword guesses, used only when the AI is not available.
  function guessService(text, services) {
    var t = text.toLowerCase();
    var map = [
      { re: /leak|drip|water (is )?coming|emergency|ceiling/, kw: 'leak' },
      { re: /replac|new roof|re-?roof|old roof/, kw: 'replac' },
      { re: /storm|hail|wind|hurricane|tree|insurance|damage/, kw: 'storm' }
    ];
    for (var i = 0; i < map.length; i++) {
      if (map[i].re.test(t)) {
        var hit = services.filter(function (s) { return s.toLowerCase().indexOf(map[i].kw) !== -1; })[0];
        if (hit) return hit;
      }
    }
    return null;
  }
  function guessOwner(text) {
    var t = text.toLowerCase();
    var no = /\b(no|nope|not|don'?t|do not|rent|renting|renter|tenant|leas(e|ing)|landlord)\b/.test(t);
    var yes = /\b(yes|yeah|yep|yup|i do|i own|owner|my (own )?(house|home|property)|of course|sure)\b/.test(t);
    if (no && !yes) return false;
    if (yes && !no) return true;
    return null;
  }
  function asksPrice(text) { return /\b(price|cost|how much|quote|charge|expensive|cheap|\$)/i.test(text); }


  /* ---------------- Automatic theme colour ----------------------------------
   * With primary_color "auto", the bot reads the host website's brand colour,
   * so it matches any client's site with no manual setup. It looks at:
   *   1. Theme CSS variables used by site builders (Lovable/shadcn, Tailwind
   *      themes, WordPress block themes, Elementor, Astra, Kadence...)
   *   2. <meta name="theme-color">
   *   3. The most common background colour of the site's buttons
   *   4. Bootstrap/Material defaults, link colour, header background
   * The first VIVID colour wins. If the site only uses dark/neutral colours,
   * its explicit theme colour is used. If nothing is found: fallback_color.
   * ------------------------------------------------------------------------ */
  var THEME_VARS = [
    '--primary', '--color-primary', '--primary-color', '--brand', '--brand-color', '--color-brand',
    '--brand-primary', '--theme-color', '--theme-primary', '--main-color', '--accent-color', '--color-accent',
    '--wp--preset--color--primary', '--wp--preset--color--accent', '--e-global-color-primary',
    '--e-global-color-accent', '--ast-global-color-0', '--global-palette1'
  ];
  var WEAK_THEME_VARS = ['--bs-primary', '--mdc-theme-primary', '--accent'];
  var BUTTON_SELECTOR = 'button, input[type="submit"], input[type="button"], [role="button"], .btn, .button, ' +
    'a[class*="btn"], a[class*="button"], .wp-block-button__link, .elementor-button';

  // Converts ANY CSS colour (hex, rgb, hsl, oklch, names, shadcn-style bare
  // "24 95% 53%") into [r, g, b] by letting the browser paint one pixel.
  var colorCtx = null;
  function colorToRgb(value) {
    value = String(value || '').trim();
    if (!value || /^(transparent|none|inherit|initial|unset|currentcolor)$/i.test(value)) return null;
    if (!colorCtx) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      colorCtx = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;
      if (!colorCtx) return null;
    }
    var attempts = [value];
    if (/^-?\.?\d/.test(value)) attempts.push(/%/.test(value) ? 'hsl(' + value + ')' : 'rgb(' + value + ')');
    for (var i = 0; i < attempts.length; i++) {
      colorCtx.fillStyle = '#010203';            // sentinel
      colorCtx.fillStyle = attempts[i];
      if (String(colorCtx.fillStyle).toLowerCase() === '#010203') continue; // browser rejected it
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillRect(0, 0, 1, 1);
      var px = colorCtx.getImageData(0, 0, 1, 1).data;
      return px[3] < 200 ? null : [px[0], px[1], px[2]]; // ignore (semi-)transparent colours
    }
    return null;
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (c) { return ('0' + c.toString(16)).slice(-2); }).join('');
  }
  function satLight(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    return { s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l: l };
  }
  // A clear brand colour: saturated, not too light or too dark.
  function isVivid(rgb) { var x = satLight(rgb); return x.s >= 0.3 && x.l >= 0.15 && x.l <= 0.8; }
  // Acceptable when the site explicitly declares it (e.g. a dark navy theme).
  function isUsable(rgb) { var x = satLight(rgb); return x.l >= 0.06 && x.l <= 0.9; }
  // Browser default link colours mean "unstyled", not a brand colour.
  function isDefaultLink(rgb) { var k = rgb.join(','); return k === '0,0,238' || k === '85,26,139' || k === '0,0,255'; }

  function backgroundOf(el) {
    var st = getComputedStyle(el);
    var rgb = colorToRgb(st.backgroundColor);
    if (!rgb) { // gradient buttons: use the first colour of the gradient
      var m = String(st.backgroundImage || '').match(/(rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/i);
      if (m) rgb = colorToRgb(m[0]);
    }
    return rgb;
  }

  function mostCommonButtonColor() {
    var els = document.querySelectorAll(BUTTON_SELECTOR);
    var scores = {}, best = null, bestScore = 0;
    for (var i = 0; i < els.length && i < 80; i++) {
      var box = els[i].getBoundingClientRect();
      if (box.width < 24 || box.height < 16) continue; // hidden or tiny
      var rgb = backgroundOf(els[i]);
      if (!rgb || !isVivid(rgb)) continue;
      var key = rgb.join(',');
      // Each button counts once; bigger buttons (main call-to-action) count a little more.
      scores[key] = (scores[key] || 0) + 1 + Math.min(box.width * box.height, 20000) / 20000;
      if (scores[key] > bestScore) { bestScore = scores[key]; best = rgb; }
    }
    return best;
  }

  function detectSiteColor() {
    var rootStyle = getComputedStyle(document.documentElement);
    var bodyStyle = document.body ? getComputedStyle(document.body) : null;
    var candidates = []; // { rgb, explicit }
    function addVar(name, explicit) {
      var v = rootStyle.getPropertyValue(name) || (bodyStyle && bodyStyle.getPropertyValue(name));
      var rgb = colorToRgb(v);
      if (rgb) candidates.push({ rgb: rgb, explicit: explicit, from: name });
    }

    THEME_VARS.forEach(function (n) { addVar(n, true); });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var metaRgb = colorToRgb(meta.getAttribute('content'));
      if (metaRgb) candidates.push({ rgb: metaRgb, explicit: true, from: 'meta theme-color' });
    }
    var btn = mostCommonButtonColor();
    if (btn) candidates.push({ rgb: btn, explicit: false, from: 'buttons' });
    WEAK_THEME_VARS.forEach(function (n) { addVar(n, false); });
    var link = document.querySelector('main a[href], article a[href], a[href]');
    if (link) {
      var linkRgb = colorToRgb(getComputedStyle(link).color);
      if (linkRgb && !isDefaultLink(linkRgb)) candidates.push({ rgb: linkRgb, explicit: false, from: 'links' });
    }
    var header = document.querySelector('header, nav, [class*="header"], [class*="navbar"]');
    if (header) {
      var headRgb = backgroundOf(header);
      if (headRgb) candidates.push({ rgb: headRgb, explicit: false, from: 'header' });
    }

    var pick = null;
    for (var i = 0; i < candidates.length && !pick; i++) if (isVivid(candidates[i].rgb)) pick = candidates[i];
    for (var j = 0; j < candidates.length && !pick; j++) if (candidates[j].explicit && isUsable(candidates[j].rgb)) pick = candidates[j];
    if (pick) log('Theme colour detected from ' + pick.from + ':', rgbToHex(pick.rgb));
    return pick ? rgbToHex(pick.rgb) : null;
  }

  // Wait until the host page's styles are applied (max 2.5 s), then detect.
  function resolveThemeColor(cfg) {
    if (cfg.primary_color !== 'auto') return Promise.resolve();
    var ready = document.readyState === 'complete' ? Promise.resolve() : new Promise(function (resolve) {
      window.addEventListener('load', resolve);
      setTimeout(resolve, 2500);
    });
    return ready.then(function () {
      var found = null;
      try { found = detectSiteColor(); } catch (e) { log('Colour detection failed:', e && e.message); }
      cfg.primary_color = found || cfg.fallback_color;
      if (!found) log('No theme colour found; using fallback', cfg.fallback_color);
    });
  }


  /* ==========================================================================
   * 5. CONFIG LOADING
   * ======================================================================== */
  function loadClientConfig() {
    return fetch(CONFIG_URL, { credentials: 'omit' })
      .then(function (res) { if (!res.ok) throw new Error('Config HTTP ' + res.status); return res.json(); })
      .then(function (db) {
        var clients = db.clients || {};
        var client = Array.isArray(clients)
          ? clients.filter(function (c) { return c.client_id === CLIENT_ID; })[0]
          : clients[CLIENT_ID];
        if (!client) throw new Error('No client found for data-client-id="' + CLIENT_ID + '"');
        if (client.active === false) throw new Error('Client "' + CLIENT_ID + '" is inactive.');
        var cfg = Object.assign({}, db.defaults || {}, client);
        cfg.client_id = CLIENT_ID;
        cfg.company_name = String(cfg.company_name || 'Our Team');
        // Colour: data-color on the script tag wins, then the config value.
        // "auto" (or no value) = match the host website's theme, resolved in init().
        var wantedColor = COLOR_OVERRIDE || cfg.primary_color || 'auto';
        cfg.fallback_color = normalizeHex(cfg.fallback_color, '#0f4c81');
        cfg.primary_color = String(wantedColor).toLowerCase() === 'auto'
          ? 'auto'
          : normalizeHex(wantedColor, cfg.fallback_color);
        cfg.region = REGION_HINTS[cfg.region] ? cfg.region : 'US';
        cfg.services = (Array.isArray(cfg.services) && cfg.services.length ? cfg.services : DEFAULT_SERVICES).slice(0, 4);
        cfg.ai_enabled = cfg.ai_enabled !== false;
        cfg.ai_max_turns = Number(cfg.ai_max_turns) || 12;
        cfg.footer_text = String(cfg.footer_text || '').replace(/\{company\}/g, cfg.company_name);
        log('Loaded config', cfg);
        return cfg;
      });
  }


  /* ==========================================================================
   * 6. STYLES (inside Shadow DOM, isolated from the client's site)
   * ======================================================================== */
  function buildStyles(cfg) {
    var p = cfg.primary_color;
    var vars = '--ra-primary:' + p + ';--ra-primary-dark:' + adjustColor(p, -0.18) +
      ';--ra-on-primary:' + readableTextColor(p) + ';--ra-tint:' + hexToRgba(p, 0.22);
    return [
      ':host{all:initial}',
      '*,*::before,*::after{box-sizing:border-box}',
      '.ra{' + vars + ';--ra-bg:#fff;--ra-surface:#f4f6f9;--ra-text:#1f2937;--ra-muted:#6b7280;--ra-border:#e5e7eb;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.45;color:var(--ra-text);-webkit-font-smoothing:antialiased}',

      /* Launcher */
      '.ra-launcher{position:fixed;bottom:24px;right:24px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;background:var(--ra-primary);color:var(--ra-on-primary);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.12);transition:transform .2s ease,background .2s ease}',
      '.ra-launcher:hover{transform:translateY(-2px) scale(1.04);background:var(--ra-primary-dark)}',
      '.ra-launcher:focus-visible{outline:3px solid var(--ra-tint);outline-offset:3px}',
      '.ra-ico{position:absolute;display:flex;transition:transform .25s ease,opacity .2s ease}',
      '.ra-ico svg{width:28px;height:28px}',
      '.ra-ico-close{opacity:0;transform:rotate(-90deg) scale(.6)}',
      '.ra-open .ra-ico-chat{opacity:0;transform:rotate(90deg) scale(.6)}',
      '.ra-open .ra-ico-close{opacity:1;transform:none}',
      '.ra-attention::before{content:"";position:absolute;inset:0;border-radius:50%;background:var(--ra-primary);z-index:-1;animation:ra-ring 2.2s ease-out infinite}',
      '.ra-badge{position:absolute;top:-3px;right:-3px;min-width:21px;height:21px;padding:0 6px;border-radius:11px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff}',

      /* Attention effects: pop-in, wiggle, "typing" teaser */
      '.ra-launcher{animation:ra-enter .6s cubic-bezier(.34,1.56,.64,1) .3s backwards}',
      '.ra-launcher.ra-wiggle{animation:ra-wiggle 1s ease both}',
      '.ra-teaser-dots{display:inline-flex;gap:4px;padding:5px 0}',
      '.ra-teaser-dots span{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:ra-bounce 1.2s infinite ease-in-out}',
      '.ra-teaser-dots span:nth-child(2){animation-delay:.15s}.ra-teaser-dots span:nth-child(3){animation-delay:.3s}',
      '.ra-teaser-text{display:none}',
      '.ra-teaser.ra-typed .ra-teaser-text{display:inline;animation:ra-pop .3s ease both}',
      '.ra-teaser.ra-typed .ra-teaser-dots{display:none}',

      /* Teaser */
      '.ra-teaser{position:fixed;bottom:98px;right:24px;z-index:2147483000;max-width:250px;background:#fff;color:var(--ra-text);padding:12px 34px 12px 14px;border-radius:14px;font-size:14px;cursor:pointer;border:1px solid var(--ra-border);box-shadow:0 10px 30px rgba(15,23,42,.16);opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .3s ease,transform .3s ease,visibility 0s linear .3s}',
      '.ra-teaser.ra-show{opacity:1;visibility:visible;transform:none;transition-delay:0s}',
      '.ra-teaser-x{position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;border-radius:50%;background:transparent;color:var(--ra-muted);cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.ra-teaser-x:hover{background:var(--ra-surface)}',
      '.ra-teaser-x svg{width:14px;height:14px}',

      /* Panel */
      '.ra-panel{position:fixed;bottom:100px;right:24px;z-index:2147483000;width:390px;max-width:calc(100vw - 32px);height:620px;max-height:calc(100vh - 130px);background:var(--ra-bg);border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.28),0 4px 14px rgba(15,23,42,.1);opacity:0;visibility:hidden;transform:translateY(24px) scale(.97);transform-origin:bottom right;transition:opacity .28s ease,transform .36s cubic-bezier(.16,1,.3,1),visibility 0s linear .36s}',
      '.ra-open .ra-panel{opacity:1;visibility:visible;transform:none;transition-delay:0s}',
      '.ra-left .ra-launcher,.ra-left .ra-panel,.ra-left .ra-teaser{right:auto;left:24px}',
      '.ra-left .ra-panel{transform-origin:bottom left}',

      /* Header */
      '.ra-header{background:linear-gradient(135deg,var(--ra-primary),var(--ra-primary-dark));color:var(--ra-on-primary);padding:16px 14px 16px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0}',
      '.ra-avatar{position:relative;width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0}',
      '.ra-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover;background:#fff}',
      '.ra-dot{position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #fff}',
      '.ra-head-text{flex:1;min-width:0}',
      '.ra-title{font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}',
      '.ra-subtitle{font-size:12.5px;opacity:.88;margin-top:2px}',
      '.ra-close{width:34px;height:34px;border:0;border-radius:10px;background:transparent;color:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.ra-close:hover,.ra-close:focus-visible{background:rgba(255,255,255,.18);outline:none}',
      '.ra-close svg{width:22px;height:22px}',

      /* Messages */
      '.ra-messages{flex:1;overflow-y:auto;padding:18px 16px 10px;background:var(--ra-surface);display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}',
      '.ra-msg{max-width:86%;padding:10px 14px;border-radius:16px;font-size:14.5px;white-space:pre-wrap;overflow-wrap:anywhere;animation:ra-pop .28s ease both}',
      '.ra-msg-bot{align-self:flex-start;background:#fff;border:1px solid var(--ra-border);border-bottom-left-radius:5px;box-shadow:0 1px 2px rgba(15,23,42,.05)}',
      '.ra-msg-user{align-self:flex-end;background:var(--ra-primary);color:var(--ra-on-primary);border-bottom-right-radius:5px}',
      '.ra-static{animation:none}',
      '.ra-typing{align-self:flex-start;background:#fff;border:1px solid var(--ra-border);border-radius:16px;border-bottom-left-radius:5px;padding:12px 14px;display:flex;gap:4px}',
      '.ra-typing span{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:ra-bounce 1.2s infinite ease-in-out}',
      '.ra-typing span:nth-child(2){animation-delay:.15s}',
      '.ra-typing span:nth-child(3){animation-delay:.3s}',

      /* Footer: quick replies + composer */
      '.ra-footer{border-top:1px solid var(--ra-border);background:#fff;padding:10px 12px 10px;flex-shrink:0}',
      '.ra-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
      '.ra-chips:empty{display:none}',
      '.ra-chip{padding:8px 13px;border-radius:999px;border:1.5px solid var(--ra-primary);background:#fff;color:var(--ra-text);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;transition:background .15s,color .15s,transform .15s;animation:ra-pop .3s ease both}',
      '.ra-chip:hover:not(:disabled),.ra-chip:focus-visible{background:var(--ra-primary);color:var(--ra-on-primary);transform:translateY(-1px);outline:none}',
      '.ra-chip:disabled{opacity:.5;cursor:default}',
      '.ra-composer{display:flex;gap:8px;align-items:flex-end}',
      '.ra-input{flex:1;min-width:0;resize:none;max-height:110px;padding:11px 14px;border:1.5px solid var(--ra-border);border-radius:14px;font:inherit;font-size:16px;line-height:1.35;color:var(--ra-text);background:#fff;outline:none;transition:border-color .15s,box-shadow .15s}',
      '.ra-input:focus{border-color:var(--ra-primary);box-shadow:0 0 0 3px var(--ra-tint)}',
      '.ra-send{flex-shrink:0;width:46px;height:46px;border:0;border-radius:14px;background:var(--ra-primary);color:var(--ra-on-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,opacity .15s}',
      '.ra-send:hover{background:var(--ra-primary-dark)}',
      '.ra-send:disabled{opacity:.5;cursor:default}',
      '.ra-send:focus-visible{outline:3px solid var(--ra-tint);outline-offset:2px}',
      '.ra-send svg{width:20px;height:20px}',
      '.ra-note{text-align:center;font-size:13px;color:var(--ra-muted);padding:6px 0}',
      '.ra-legal{font-size:11px;color:var(--ra-muted);text-align:center;margin-top:8px}',
      '.ra-legal:empty{display:none}',
      '.ra-hidden{display:none!important}',

      /* Mobile full-screen */
      '@media (max-width:480px){',
      '.ra-launcher{bottom:16px;right:16px}.ra-left .ra-launcher{left:16px}',
      '.ra-teaser{bottom:88px;right:16px;max-width:calc(100vw - 32px)}.ra-left .ra-teaser{left:16px}',
      '.ra-panel,.ra-left .ra-panel{inset:0;width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0;transform:translateY(40px);transform-origin:bottom center}',
      '@supports (height:100dvh){.ra-panel{height:100dvh;max-height:100dvh}}',
      '.ra-open .ra-launcher{display:none}',
      '}',

      '@keyframes ra-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@keyframes ra-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}',
      '@keyframes ra-ring{0%{transform:scale(1);opacity:.45}100%{transform:scale(1.55);opacity:0}}',
      '@keyframes ra-enter{from{opacity:0;transform:scale(.3) translateY(24px)}to{opacity:1;transform:none}}',
      '@keyframes ra-wiggle{0%,100%{transform:none}15%{transform:rotate(-14deg) scale(1.1)}30%{transform:rotate(11deg) scale(1.1)}45%{transform:rotate(-8deg) scale(1.06)}60%{transform:rotate(5deg)}75%{transform:rotate(-2deg)}}',
      '@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}'
    ].join('');
  }


  /* ==========================================================================
   * 7. THE WIDGET
   * ======================================================================== */
  function createWidget(cfg) {
    var COPY = buildCopy(cfg);
    var SERVICE_LABELS = cfg.services;
    var SERVICE_NAMES = SERVICE_LABELS.map(stripEmoji);
    var STORAGE_KEY = 'roof_assistant_v2_' + CLIENT_ID;
    var ui = {};
    var busy = false;
    var teaserTimer = null;

    /* ---------------- State (kept per browser tab) ------------------------ */
    function freshState() {
      return {
        step: STEP.INIT,
        collected: { service: null, is_owner: null, zip: null, phone: null, email: null },
        transcript: [],         // [{from:'bot'|'user', text}]
        chips: [],              // quick replies currently offered
        ai_turns: 0,
        ai_failed: false,       // once the AI fails, stay scripted for this chat
        open: false,
        teaser_dismissed: false
      };
    }
    function loadState() {
      try {
        var s = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (s && s.step === STEP.INIT) return null;
        return s;
      } catch (e) { return null; }
    }
    function saveState() {
      try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    }
    var state = Object.assign(freshState(), loadState() || {});

    /* ---------------- Build the DOM --------------------------------------- */
    function mount() {
      var host = el('div', { id: 'roof-assistant-host', 'data-client': CLIENT_ID });
      hostEl = host;
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, onGesture, { capture: true, passive: true });
      });
      document.body.appendChild(host);
      var root = host.attachShadow({ mode: 'open' });
      root.appendChild(el('style', { text: buildStyles(cfg) }));
      ui.wrap = el('div', { class: 'ra' + (cfg.position === 'left' ? ' ra-left' : '') });

      ui.launcher = el('button', {
        class: 'ra-launcher', type: 'button', 'aria-label': 'Chat with ' + cfg.company_name,
        'aria-expanded': 'false', 'aria-controls': 'ra-panel',
        onclick: function () { state.open ? close() : open(); }
      });
      ui.launcher.innerHTML = '<span class="ra-ico ra-ico-chat">' + ICONS.chat + '</span><span class="ra-ico ra-ico-close">' + ICONS.close + '</span>';
      ui.badge = el('span', { class: 'ra-badge', text: '1', 'aria-hidden': 'true' });
      if (!state.transcript.length) { ui.launcher.appendChild(ui.badge); ui.launcher.classList.add('ra-attention'); }

      if (cfg.teaser_text && !state.teaser_dismissed && !state.transcript.length) {
        var tx = el('button', { class: 'ra-teaser-x', type: 'button', 'aria-label': 'Dismiss',
          onclick: function (e) { e.stopPropagation(); hideTeaser(true); } });
        tx.innerHTML = ICONS.close;
        ui.teaser = el('div', { class: 'ra-teaser', role: 'button', tabindex: '0', onclick: function () { open(); },
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
          [el('span', { class: 'ra-teaser-dots', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]),
           el('span', { class: 'ra-teaser-text', text: cfg.teaser_text }), tx]);
        teaserTimer = setTimeout(function () {
          if (state.open || !ui.teaser) return;
          ui.teaser.classList.add('ra-show');          // pops up showing "typing" dots…
          teaserTimer = setTimeout(function () {
            if (state.open || !ui.teaser) return;
            ui.teaser.classList.add('ra-typed');       // …then the message appears,
            wiggleLauncher();                          // the bubble wiggles,
            chime('teaser');                           // and a soft chime plays (when the browser allows)
          }, 1400);
        }, Number(cfg.teaser_delay_ms) || 4000);
      } else if (!state.transcript.length) {
        wiggleTimer = setTimeout(wiggleLauncher, Number(cfg.teaser_delay_ms) || 4000);
      }
      ui.launcher.addEventListener('animationend', function (e) {
        if (e.animationName === 'ra-wiggle') ui.launcher.classList.remove('ra-wiggle');
      });

      var avatar = el('div', { class: 'ra-avatar', 'aria-hidden': 'true' });
      if (cfg.logo_url) avatar.appendChild(el('img', { src: cfg.logo_url, alt: '' }));
      else avatar.appendChild(document.createTextNode(initials(cfg.company_name)));
      avatar.appendChild(el('span', { class: 'ra-dot' }));
      var closeBtn = el('button', { class: 'ra-close', type: 'button', 'aria-label': 'Minimize chat', onclick: close });
      closeBtn.innerHTML = ICONS.down;

      var header = el('div', { class: 'ra-header' }, [
        avatar,
        el('div', { class: 'ra-head-text' }, [
          el('h2', { class: 'ra-title', id: 'ra-title', text: cfg.company_name }),
          el('div', { class: 'ra-subtitle', text: '24/7 Roof Assistant · Online now' })
        ]),
        closeBtn
      ]);

      ui.messages = el('div', { class: 'ra-messages', role: 'log', 'aria-live': 'polite' });
      ui.chips = el('div', { class: 'ra-chips', role: 'group', 'aria-label': 'Suggested replies' });

      // Composer: auto-growing textarea + send button. Enter sends, Shift+Enter = new line.
      ui.input = el('textarea', { class: 'ra-input', rows: '1', maxlength: String(MAX_INPUT),
        placeholder: REGION_HINTS[cfg.region].placeholder, 'aria-label': 'Type your message', enterkeyhint: 'send' });
      ui.input.addEventListener('input', autoGrow);
      ui.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTyped(); }
      });
      ui.send = el('button', { class: 'ra-send', type: 'button', 'aria-label': 'Send', onclick: submitTyped });
      ui.send.innerHTML = ICONS.send;
      ui.composer = el('div', { class: 'ra-composer' }, [ui.input, ui.send]);
      ui.note = el('div', { class: 'ra-note ra-hidden' });

      var footer = el('div', { class: 'ra-footer' }, [ui.chips, ui.composer, ui.note,
        el('div', { class: 'ra-legal', text: cfg.footer_text })]);

      ui.panel = el('div', { class: 'ra-panel', id: 'ra-panel', role: 'dialog', 'aria-labelledby': 'ra-title', 'aria-hidden': 'true' },
        [header, ui.messages, footer]);

      ui.wrap.appendChild(ui.panel);
      if (ui.teaser) ui.wrap.appendChild(ui.teaser);
      ui.wrap.appendChild(ui.launcher);
      root.appendChild(ui.wrap);
      ui.wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });

      // Restore a conversation from another page of the same site
      state.transcript.forEach(function (m) { appendBubble(m.from, m.text, false); });
      renderFooter();
      if (state.open && !isSmallScreen()) open(true); else state.open = false;
    }

    function autoGrow() {
      ui.input.style.height = 'auto';
      ui.input.style.height = Math.min(ui.input.scrollHeight, 110) + 'px';
    }

    /* ---------------- Open / close ---------------------------------------- */
    function open(silent) {
      state.open = true;
      ui.wrap.classList.add('ra-open');
      ui.launcher.setAttribute('aria-expanded', 'true');
      ui.launcher.setAttribute('aria-label', 'Close chat');
      ui.panel.setAttribute('aria-hidden', 'false');
      ui.launcher.classList.remove('ra-attention');
      if (ui.badge.parentNode) ui.badge.parentNode.removeChild(ui.badge);
      hideTeaser(false);
      clearTimeout(wiggleTimer);
      ui.launcher.classList.remove('ra-wiggle');
      saveState();
      if (state.step === STEP.INIT) startConversation();
      if (!silent && !isSmallScreen()) setTimeout(function () { ui.input.focus(); }, 380);
      scrollToBottom();
    }
    function close() {
      state.open = false;
      ui.wrap.classList.remove('ra-open');
      ui.launcher.setAttribute('aria-expanded', 'false');
      ui.launcher.setAttribute('aria-label', 'Chat with ' + cfg.company_name);
      ui.panel.setAttribute('aria-hidden', 'true');
      saveState();
      ui.launcher.focus();
    }
    function hideTeaser(dismissed) {
      clearTimeout(teaserTimer);
      pendingChime = false;
      if (ui.teaser) ui.teaser.classList.remove('ra-show');
      if (dismissed) { state.teaser_dismissed = true; saveState(); }
    }

    /* ---------------- Attention: wiggle ----------------------------------- */
    // The launcher wiggles when the teaser appears, then every 8 s (max 4 times)
    // until the visitor opens the chat. Turn off with "attention_effects": false.
    var wiggles = 0, wiggleTimer = null;
    function wiggleLauncher() {
      if (cfg.attention_effects === false || state.open || state.transcript.length) return;
      ui.launcher.classList.remove('ra-wiggle');
      void ui.launcher.offsetWidth;                    // restart the animation
      ui.launcher.classList.add('ra-wiggle');
      if (++wiggles < 4) wiggleTimer = setTimeout(wiggleLauncher, 8000);
    }

    /* ---------------- Attention: sound ------------------------------------
     * Browsers block sound until the visitor has clicked, tapped or pressed a
     * key on the page. So the teaser chime plays immediately if they already
     * have; otherwise it plays on their first click/tap while the teaser is
     * showing. While the chat is open, each bot reply makes a very soft "pop".
     * The sounds are generated in code (no audio files). "sound": false = off.
     * --------------------------------------------------------------------- */
    var audioCtx = null, pendingChime = false, userActive = false, hostEl = null;
    function hasUserActivation() {
      return navigator.userActivation ? navigator.userActivation.hasBeenActive : userActive;
    }
    function ensureAudio() {
      try {
        if (!audioCtx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
      } catch (e) { return null; }
    }
    function playTones(kind) {
      if (cfg.sound === false || !hasUserActivation()) return;
      var ctx = ensureAudio();
      if (!ctx) return;
      var notes = kind === 'teaser' ? [[659.25, 0], [880, 0.13]] : [[740, 0]]; // E5→A5 chime, or one soft pop
      var vol = kind === 'teaser' ? 0.08 : 0.03;
      notes.forEach(function (n) {
        var osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + n[1];
        osc.type = 'sine';
        osc.frequency.value = n[0];
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    }
    function chime(kind) {
      if (cfg.sound === false) return;
      if (hasUserActivation()) playTones(kind);
      else if (kind === 'teaser') pendingChime = true; // wait for the first click/tap
    }
    function onGesture(e) {
      userActive = true;
      if (cfg.sound === false) return;
      var onWidget = !!(e.composedPath && hostEl && e.composedPath().indexOf(hostEl) !== -1);
      if (pendingChime && !state.open && !onWidget) { pendingChime = false; playTones('teaser'); }
      else if (onWidget) ensureAudio(); // unlocks audio for reply sounds (needed on iPhone/Safari)
    }
    function scrollToBottom() { ui.messages.scrollTop = ui.messages.scrollHeight; }

    /* ---------------- Messages -------------------------------------------- */
    function appendBubble(from, text, animate) {
      ui.messages.appendChild(el('div', { class: 'ra-msg ra-msg-' + from + (animate ? '' : ' ra-static'), text: text }));
      scrollToBottom();
    }
    function record(from, text) { state.transcript.push({ from: from, text: text }); saveState(); }
    function userSay(text) { appendBubble('user', text, true); record('user', text); }

    function showTyping() {
      var t = el('div', { class: 'ra-typing', 'aria-label': 'Assistant is typing' }, [el('span'), el('span'), el('span')]);
      ui.messages.appendChild(t);
      scrollToBottom();
      return function () { if (t.parentNode) t.parentNode.removeChild(t); };
    }
    // Scripted bot message with a short, natural typing delay.
    function botSay(text, chips) {
      var hide = showTyping();
      return wait(Math.min(1300, 450 + text.length * 8)).then(function () {
        hide();
        botPost(text, chips);
      });
    }
    // Bot message with no extra delay (AI replies already took time).
    function botPost(text, chips) {
      appendBubble('bot', text, true);
      record('bot', text);
      if (state.open) chime('reply');
      state.chips = chips || [];
      saveState();
      renderFooter();
    }

    /* ---------------- Footer rendering ------------------------------------ */
    function renderFooter() {
      while (ui.chips.firstChild) ui.chips.removeChild(ui.chips.firstChild);
      var ended = state.step === STEP.DONE || state.step === STEP.CLOSED;

      ui.composer.classList.toggle('ra-hidden', ended);
      ui.note.classList.toggle('ra-hidden', !ended);
      ui.note.textContent = state.step === STEP.DONE ? COPY.doneNote : state.step === STEP.CLOSED ? COPY.closedNote : '';
      ui.send.disabled = busy;
      if (ended) return;

      (state.chips || []).forEach(function (label) {
        ui.chips.appendChild(el('button', { class: 'ra-chip', type: 'button', text: label, disabled: busy,
          onclick: function () { handleUserMessage(label, true); } }));
      });
    }
    function setBusy(v) { busy = v; renderFooter(); }

    /* ---------------- Conversation logic ---------------------------------- */
    function startConversation() {
      state.step = STEP.CHAT;
      setBusy(true);
      botSay(COPY.greeting, SERVICE_LABELS).then(function () { setBusy(false); });
    }

    function submitTyped() {
      var text = ui.input.value.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT);
      if (!text || busy) return;
      ui.input.value = '';
      autoGrow();
      handleUserMessage(text, false);
    }

    function isComplete() {
      var c = state.collected;
      return c.is_owner === true && !!c.zip && !!c.phone && !!c.email;
    }

    // Merge new details, validating everything. The gatekeeper answer is final:
    // once it is set it can't be flipped by a later message.
    function merge(data) {
      if (!data) return;
      var c = state.collected;
      if (!c.service && data.service) {
        var match = SERVICE_NAMES.filter(function (s) { return s.toLowerCase() === String(data.service).toLowerCase(); })[0];
        c.service = match || String(data.service).slice(0, 60);
      }
      if (c.is_owner === null && (data.is_owner === true || data.is_owner === false)) c.is_owner = data.is_owner;
      if (data.zip && validZip(data.zip, cfg.region)) c.zip = String(data.zip).toUpperCase().trim();
      if (data.phone && validPhone(String(data.phone).trim())) c.phone = String(data.phone).trim();
      if (data.email && validEmail(String(data.email).trim().toLowerCase())) c.email = String(data.email).trim().toLowerCase();
      saveState();
    }

    function handleUserMessage(text, fromChip) {
      if (busy || state.step !== STEP.CHAT) return;
      userSay(text);
      setBusy(true);

      var c = state.collected;

      // 1) Deterministic capture first.
      if (fromChip) {
        var idx = SERVICE_LABELS.indexOf(text);
        if (idx !== -1 && !c.service) c.service = SERVICE_NAMES[idx];
        if (text === OWNER_YES && c.is_owner === null) c.is_owner = true;
        if (text === OWNER_NO && c.is_owner === null) c.is_owner = false;
      }
      var extracted = extractDetails(text, cfg.region);
      merge(extracted);
      // A short message that only contains details (e.g. "32801" or a phone
      // number) is handled by the script too: no AI call needed.
      var justDetails = Object.keys(extracted).length > 0 && text.length <= 80 && text.indexOf('?') === -1;

      // 2) Hard rules enforced in code, no AI needed.
      if (c.is_owner === false) return endAsTenant();
      if (isComplete()) return finishLead();

      // 3) Otherwise let the AI answer (or the script, as a fallback).
      // Taps on our own service / owner buttons don't need the AI at all: the
      // script answers them instantly and saves your free AI allowance.
      var structuredChip = fromChip && (SERVICE_LABELS.indexOf(text) !== -1 || text === OWNER_YES || text === OWNER_NO);
      var useAI = cfg.ai_enabled && !structuredChip && !justDetails && !state.ai_failed && state.ai_turns < cfg.ai_max_turns;
      var next = useAI ? askAI(text) : Promise.reject(new Error('AI not in use'));

      next.catch(function (err) {
        if (useAI) { log('AI unavailable, switching to scripted mode:', err && err.message); state.ai_failed = true; }
        return scriptedReply(text, fromChip);
      }).then(function () {
        setBusy(false);
        if (!isSmallScreen()) ui.input.focus();
      });
    }

    function askAI(text) {
      state.ai_turns++;
      // Gatekeeper protection: we only accept an ownership answer from the AI
      // if the ownership question was the last thing we asked.
      var askedOwnership = state.chips && state.chips[0] === OWNER_YES;
      var hide = showTyping();
      var controller = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, AI_TIMEOUT_MS);

      var history = state.transcript.slice(-12).map(function (m) {
        return { role: m.from === 'user' ? 'user' : 'assistant', content: m.text };
      });

      var request = fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, messages: history, collected: state.collected }),
        credentials: 'omit',
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (!res.ok) throw new Error('AI HTTP ' + res.status);
        return res.json();
      });

      return Promise.all([request, wait(500)]).then(function (out) {
        clearTimeout(timer);
        hide();
        var ai = out[0];
        if (!ai || typeof ai.reply !== 'string' || !ai.reply.trim()) throw new Error('Empty AI reply');

        if (ai.data && !askedOwnership) ai.data.is_owner = null;
        merge(ai.data);
        var c = state.collected;
        if (c.is_owner === false) return endAsTenant(true);
        if (isComplete()) return finishLead(true);

        botPost(ai.reply.trim().slice(0, 700), chipsFor(ai.quick_replies));
      }, function (err) {
        clearTimeout(timer);
        hide();
        throw err;
      });
    }

    // Our own chips always win for the two structured moments, so the
    // service and owner answers are captured exactly.
    function chipsFor(aiChips) {
      var c = state.collected;
      if (!c.service) return SERVICE_LABELS;
      if (c.is_owner === null) return [OWNER_YES, OWNER_NO];
      return (Array.isArray(aiChips) ? aiChips : []).filter(function (q) { return typeof q === 'string' && q.trim(); })
        .map(function (q) { return q.trim().slice(0, 40); }).slice(0, 3);
    }

    // Step-by-step script, used when the AI is off or unavailable.
    function scriptedReply(text, fromChip) {
      var c = state.collected;
      var prefix = asksPrice(text) ? COPY.price + ' ' : '';

      if (!c.service) {
        var s = fromChip ? null : guessService(text, SERVICE_NAMES);
        if (s) c.service = s;
        else return botSay(prefix + COPY.pickService, SERVICE_LABELS);
      }
      if (c.is_owner === null) {
        // Only interpret free text as an ownership answer if we actually asked
        // the ownership question last, so the gatekeeper question is never skipped.
        var askedOwnership = state.chips && state.chips[0] === OWNER_YES;
        var owner = (!fromChip && askedOwnership) ? guessOwner(text) : null;
        if (owner === false) { c.is_owner = false; return endAsTenant(); }
        if (owner === true) c.is_owner = true;
        else return botSay(prefix + (state.chips && state.chips[0] === OWNER_YES ? COPY.ownershipAgain : COPY.ownership), [OWNER_YES, OWNER_NO]);
      }
      saveState();
      if (isComplete()) return finishLead();
      if (!c.zip) return botSay(prefix + (state.transcript.length && /zip|postcode/i.test(lastBotText()) ? COPY.zipAgain : COPY.zip), []);
      if (!c.phone && !c.email) return botSay(prefix + COPY.contact, []);
      if (!c.phone) return botSay(prefix + COPY.needPhone, []);
      return botSay(prefix + COPY.needEmail, []);
    }
    function lastBotText() {
      for (var i = state.transcript.length - 1; i >= 0; i--) if (state.transcript[i].from === 'bot') return state.transcript[i].text;
      return '';
    }

    function endAsTenant(noDelay) {
      var p = noDelay ? Promise.resolve(botPost(COPY.notOwner, [])) : botSay(COPY.notOwner, []);
      return p.then(function () { state.step = STEP.CLOSED; saveState(); setBusy(false); });
    }

    function finishLead(noDelay) {
      if (!state.collected.service) state.collected.service = 'Not specified';
      var payload = buildPayload();
      return submitLead(payload).then(function () {
        return noDelay ? botPost(COPY.closing, []) : botSay(COPY.closing, []);
      }).then(function () {
        state.step = STEP.DONE;
        saveState();
        setBusy(false);
      });
    }

    /* ---------------- Lead payload & delivery ----------------------------- */
    function buildPayload() {
      var c = state.collected;
      return {
        client_id: cfg.client_id,
        company_name: cfg.company_name,
        service_selected: c.service,
        zip_code: c.zip,
        contact_info: { phone: c.phone, email: c.email },
        // The whole chat, so the roofer can read any questions before calling.
        conversation: state.transcript.map(function (m) {
          return (m.from === 'user' ? 'Customer: ' : 'Assistant: ') + m.text;
        }).join('\n'),
        meta: {
          is_property_owner: c.is_owner === true,
          page_url: window.location.href,
          submitted_at: new Date().toISOString(),
          visitor_timezone: (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
          ai_used: state.ai_turns > 0 && !state.ai_failed,
          widget_version: WIDGET_VERSION
        }
      };
    }

    function submitLead(payload) {
      console.log('[RoofAssistant] Lead captured:', payload);
      var jobs = [];
      if (cfg.webhook_url) jobs.push(postToWebhook(cfg.webhook_url, payload));
      if (cfg.email) jobs.push(postToEmail(cfg.email, payload));
      if (!jobs.length) console.warn('[RoofAssistant] No webhook_url or email configured for "' + CLIENT_ID + '". Lead was only logged.');

      return Promise.all(jobs.map(function (job) {
        return job.then(function () { return { ok: true }; }, function (err) {
          console.error('[RoofAssistant] Lead delivery failed:', err && err.message ? err.message : err);
          return { ok: false };
        });
      })).then(function (results) {
        try { window.dispatchEvent(new CustomEvent('roofassistant:lead', { detail: payload })); } catch (e) { /* old browsers */ }
        return results;
      });
    }

    // JSON POST first; if the browser blocks it at the CORS level, retry as a
    // simple text/plain request. HTTP errors are not retried (no duplicates).
    function postToWebhook(url, payload) {
      var body = JSON.stringify(payload);
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'omit' })
        .then(function (res) { if (!res.ok) throw new Error('Webhook HTTP ' + res.status); return res; },
          function () {
            return fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: body, keepalive: true, credentials: 'omit' });
          });
    }

    // Email via the free FormSubmit relay. The client confirms once on the first lead.
    function postToEmail(address, p) {
      return fetch('https://formsubmit.co/ajax/' + encodeURIComponent(address), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: '🏠 New roofing lead: ' + p.service_selected + ' (' + p.zip_code + ')',
          _template: 'table',
          _captcha: 'false',
          'Company': p.company_name,
          'Service requested': p.service_selected,
          'ZIP code': p.zip_code,
          'Phone': p.contact_info.phone,
          'Email': p.contact_info.email,
          'Property owner': p.meta.is_property_owner ? 'Yes' : 'No',
          'Full conversation': p.conversation,
          'Page': p.meta.page_url,
          'Submitted (UTC)': p.meta.submitted_at
        }),
        credentials: 'omit'
      }).then(function (res) { if (!res.ok) throw new Error('Email relay HTTP ' + res.status); return res; });
    }

    /* ---------------- Boot ------------------------------------------------ */
    mount();
    window.RoofAssistant.open = function () { open(); };
    window.RoofAssistant.close = close;
    window.RoofAssistant.state = function () { return JSON.parse(JSON.stringify(state)); };
    window.RoofAssistant.reset = function () {
      try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      window.location.reload();
    };
  }


  /* ==========================================================================
   * 8. INIT
   * ======================================================================== */
  function init() {
    if (!document.body || !document.body.attachShadow) {
      console.warn('[RoofAssistant] This browser does not support Shadow DOM. Widget not loaded.');
      return;
    }
    loadClientConfig().then(function (cfg) {
      if (!isDomainAllowed(cfg.allowed_domains)) {
        console.warn('[RoofAssistant] "' + window.location.hostname + '" is not in allowed_domains for "' + CLIENT_ID + '". Widget not loaded.');
        return;
      }
      return resolveThemeColor(cfg).then(function () { createWidget(cfg); });
    }).catch(function (err) {
      console.error('[RoofAssistant] Failed to start:', err && err.message ? err.message : err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window, document);

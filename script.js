/* ============================================================
   Dongfeng MAGE landing — interactions
   - Modal open/close (click, backdrop, Escape, focus trap)
   - Form submit: POST a gateway Apps Script (Sheet + Zapier) + dataLayer
   - Sticky CTA mobile · Top bar dismiss · Reveal on scroll
   ============================================================ */

(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* ----------  MODAL  ---------- */
  const modal = $('#modal');
  const modalContent = $('.modal__content', modal);
  const LEAD_SENT_KEY = 'dongfeng_lead_sent';
  let lastFocused = null;

  function leadAlreadySent() {
    try { return sessionStorage.getItem(LEAD_SENT_KEY) === '1'; }
    catch { return false; }
  }

  function showView(viewName) {
    $$('.modal__body', modal).forEach(v => v.hidden = v.dataset.view !== viewName);
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    if (leadAlreadySent()) showView('success');
    requestAnimationFrame(() => {
      const firstInput = $('input, button', modal);
      if (firstInput) firstInput.focus();
    });
  }

  function closeModal() {
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    if (!leadAlreadySent()) {
      showView('form');
      $('#leadForm')?.reset();
    }
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  $$('[data-open-modal]').forEach(btn => btn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  }));

  $$('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
    if (e.key === 'Tab' && !modal.hidden) {
      const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modalContent)
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ----------  FORM SUBMIT  ----------
     Puerta de entrada (Apps Script): valida el lead y, solo si pasa el filtro
     antibots, lo escribe en la Sheet y lo reenvía a Zapier (server-side).
     Códigos CRM del MAGE confirmados (08-jul-2026): Model_Code 821,
     Campaign_Code CPH020 (común Dongfeng), FORM_TOKEN dfmage-* propio. El
     DISTRIBUIDOR del MAGE es Salvador Caetano (confirmado en brief), por lo que
     el mapa de dealers por CP es válido. Pendiente go-live: pegar la URL /exec
     del gateway propio del MAGE (ver TODO deploy abajo). */
  // Gateway propio del MAGE (Apps Script → Sheet "Leads Dongfeng Mage").
  // TODO deploy: pegar aquí la URL /exec del Web App tras desplegar
  // gateway/apps-script-gateway.gs. Vacío = el lead NO se envía (solo dataLayer).
  const GATEWAY_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyBjEr5jAxKusK0B0Wr9dqmxxa-C-q67uvr5P1XlM5PjmpL0Ff2ysT-nYi8wDcKwkczAA/exec';
  const FORM_TOKEN = 'dfmage-p8w4n62rk';

  function splitName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    return { first: parts.shift() || '', last: parts.join(' ') };
  }

  function normalizePhoneES(raw) {
    let p = (raw || '').replace(/[\s\-().]/g, '');
    if (!p) return '';
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('+')) return p;
    if (/^34[6789]\d{8}$/.test(p)) return '+' + p;
    if (/^[6789]\d{8}$/.test(p)) return '+34' + p;
    return p;
  }

  // CP español → código de concesionario Salvador Caetano (distribuidor del MAGE).
  function dealerCodeFromCP(cp) {
    const digits = (cp || '').replace(/\D/g, '');
    if (digits.length < 2) return '';
    const n = parseInt(digits, 10);
    if (n >= 8200 && n <= 8208) return 'DE00060002';   // Sabadell
    if (n >= 28220 && n <= 28229) return 'DE05710004'; // Majadahonda
    if (n >= 46700 && n <= 46729) return 'DE06350009'; // Gandía
    const province = digits.slice(0, 2);
    const provinceToDealer = {
      '03': 'DE00110011', '07': 'DE00080001', '08': 'DE05840006', '15': 'DE00110012',
      '17': 'DE00180001', '19': 'DE00160001', '28': 'DE00050002', '29': 'DE01050013',
      '30': 'DE00070002', '31': 'DE00150001', '33': 'DE00110005', '39': 'DE00070001',
      '41': 'DE00110001', '43': 'DE00140001', '47': 'DE00090001', '48': 'DE01100014',
      '50': 'DE00100004', '35': 'DE00780003', '38': 'DE00090002'
    };
    return provinceToDealer[province] || '';
  }

  const REGION = (typeof window !== 'undefined' && window.LANDING_REGION)
    || (/^\/canarias(\/|$)/i.test(location.pathname) ? 'CAN' : 'PEN');

  function buildPayload({ name, last_name, phone, cp, email, dealer }) {
    return {
      Name: name,
      Last_Name: last_name,
      Email: email || '',
      Phone: phone,
      Model_Code: '821',           // Dongfeng MAGE PHEV (confirmado 08-jul-2026)
      Dealership_Code: dealer || '',
      Postal_Code: cp || '',
      Privacy_Policy: 'Y',
      Consent: true,
      Lead_Type: 'TP10',
      Request_Type: 'TPD10',
      Lead_Source: 'OL24',
      Form_Type: 'F12',
      Campaign_Code: 'CPH020',     // confirmado 08-jul-2026 (común Dongfeng)
      Brand_Code: 'DON',
      Country_Code: 'ES',
      Region: REGION
    };
  }

  function sendToGateway(payload) {
    if (!GATEWAY_WEBHOOK) return Promise.resolve(null);
    return fetch(GATEWAY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(r => r.text().then(t => { try { return JSON.parse(t); } catch { return { status: r.ok ? 'success' : 'error', raw: t }; } }))
      .then(res => { console.info('[Dongfeng MAGE] gateway ok:', res); return res; })
      .catch(err => { console.error('[Dongfeng MAGE] gateway error:', err); });
  }

  const leadForm = $('#leadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(leadForm).entries());
      const { first, last } = splitName(data.name);   // split solo para Enhanced Conversions
      const fullName = (data.name || '').trim();       // CRM: nombre+apellidos completo → Last_Name
      const phone = normalizePhoneES(data.phone);
      const cp = (data.cp || '').replace(/\D/g, '');
      const dealer = dealerCodeFromCP(cp);

      const payload = buildPayload({ name: '', last_name: fullName, phone, cp, email: data.email || '', dealer });
      payload._t = FORM_TOKEN;
      payload._hp = data.fax || '';

      sendToGateway(payload);

      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'generate_lead',
        form_name: 'test_drive',
        dealer,
        enhanced_conversion_data: {
          email: data.email || '',
          phone_number: phone,
          address: { first_name: first, last_name: last, postal_code: cp, country: 'ES' }
        }
      });

      try { sessionStorage.setItem(LEAD_SENT_KEY, '1'); } catch {}
      showView('success');
    });
  }

  /* ----------  TOP BAR  ---------- */
  const topbar = $('#topbar');
  $('[data-close-topbar]')?.addEventListener('click', () => { topbar.hidden = true; });

  /* ----------  STICKY CTA MOBILE  ---------- */
  const stickyCta = $('#stickyCta');
  const heroEl = $('.hero');
  const ctaFinalEl = $('.cta-final');

  if (stickyCta && heroEl && ctaFinalEl && 'IntersectionObserver' in window) {
    let heroVisible = true, ctaFinalVisible = false;
    const heroObs = new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; updateStickyCta(); }, { threshold: 0.25 });
    const finalObs = new IntersectionObserver(([entry]) => { ctaFinalVisible = entry.isIntersecting; updateStickyCta(); }, { threshold: 0.1 });
    heroObs.observe(heroEl);
    finalObs.observe(ctaFinalEl);
    function updateStickyCta() { stickyCta.classList.toggle('is-visible', !heroVisible && !ctaFinalVisible); }
  }

  /* ----------  REVEAL ON SCROLL  ---------- */
  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const revealTargets = $$('.section-head, .step');
    revealTargets.forEach(el => el.classList.add('reveal'));
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); revealObs.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    revealTargets.forEach(el => revealObs.observe(el));
  }

})();

/* ============================================================
   MAGE — interacciones específicas de esta landing
   (toggle dual-mode, tour interior por hotspots, barra de autonomía, color)
   ============================================================ */
(() => {
  'use strict';
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* ----------  DUAL-MODE: eléctrico ⇄ viaje  ---------- */
  const tabs = $$('.dualmode__tab');
  const panels = $$('.dualmode__panel');
  function setMode(mode) {
    tabs.forEach(t => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(p => p.classList.toggle('is-active', p.dataset.mode === mode));
  }
  tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

  /* ----------  INTERIOR: hotspots  ---------- */
  const HS = [
    { title: 'Pantalla cascada de 14,6"', text: 'Una pantalla táctil vertical de alta resolución que reúne navegación, multimedia y clima. Compatible con Apple CarPlay y Android Auto.' },
    { title: 'Head-Up Display', text: 'La información clave —velocidad, navegación, asistencias— proyectada sobre el parabrisas. No apartas la vista de la carretera.' },
    { title: 'ADAS Nivel 2', text: 'Conducción asistida de nivel 2: control de crucero adaptativo, mantenimiento de carril y frenada de emergencia trabajando juntos en autopista.' },
    { title: 'Cámara 360°', text: 'Vista cenital de 360° alrededor del coche para aparcar en el hueco más justo sin un roce.' }
  ];
  const hsStage = $('#hsStage'), hsPop = $('#hsPop'), hsTitle = $('#hsTitle'), hsText = $('#hsText');
  const dots = $$('.hotspot'), hsTabs = $$('.hotspots__nav button');
  let hsCurrent = 0;
  function placePop(dot) {
    if (!hsStage || !hsPop) return;
    const sr = hsStage.getBoundingClientRect();
    if (sr.width <= 560) { hsPop.style.left = ''; hsPop.style.top = ''; return; }
    const dotX = parseFloat(dot.style.left) / 100 * sr.width;
    const dotY = parseFloat(dot.style.top) / 100 * sr.height;
    const pw = hsPop.offsetWidth || 250, ph = hsPop.offsetHeight || 90;
    let x = Math.max(12, Math.min(dotX - pw / 2, sr.width - pw - 12));
    let y = dotY + 26;
    if (y + ph > sr.height - 12) y = Math.max(12, dotY - ph - 26);
    hsPop.style.left = x + 'px';
    hsPop.style.top = y + 'px';
  }
  function setHotspot(i) {
    const d = HS[i]; if (!d) return;
    hsCurrent = i;
    if (hsTitle) hsTitle.textContent = d.title;
    if (hsText)  hsText.textContent = d.text;
    dots.forEach(b => b.classList.toggle('is-active', +b.dataset.index === i));
    hsTabs.forEach(b => b.classList.toggle('is-active', +b.dataset.index === i));
    const dot = dots.find(b => +b.dataset.index === i);
    if (dot) placePop(dot);
    if (hsPop) hsPop.classList.add('is-shown');
  }
  [...dots, ...hsTabs].forEach(b => b.addEventListener('click', () => setHotspot(+b.dataset.index)));
  window.addEventListener('resize', () => { const dot = dots.find(b => +b.dataset.index === hsCurrent); if (dot) placePop(dot); });
  if (dots.length) setHotspot(0);

  /* ----------  AUTONOMÍA: anima la barra al entrar en viewport  ---------- */
  const rangeBar = $('#rangeBar');
  if (rangeBar && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { rangeBar.classList.add('is-in'); obs.disconnect(); } });
    }, { threshold: 0.4 });
    obs.observe(rangeBar);
  } else if (rangeBar) { rangeBar.classList.add('is-in'); }

  /* ----------  COLORES: selector  ---------- */
  const stage = $('#colorStage');
  if (stage) {
    const imgs = $$('img', stage);
    const swatches = $$('.colors__swatch');
    const nameEl = $('#colorName');
    swatches.forEach(sw => sw.addEventListener('click', () => {
      const i = +sw.dataset.index;
      imgs.forEach(im => im.classList.toggle('is-active', +im.dataset.index === i));
      swatches.forEach(s => s.classList.toggle('is-active', s === sw));
      if (nameEl) nameEl.textContent = sw.dataset.name;
    }));
  }

  /* ----------  REVEAL extra para secciones nuevas  ---------- */
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReduced && 'IntersectionObserver' in window) {
    const targets = $$('.dualmode__viz, .range__card');
    targets.forEach(el => el.classList.add('reveal'));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); obs.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    targets.forEach(el => obs.observe(el));
  }
})();

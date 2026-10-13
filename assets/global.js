(() => {
  const theme = window.theme || {};
  const parser = new DOMParser();
  const parseHTML = (html) => parser.parseFromString(html, 'text/html');
  const debounce = (fn, wait = 300) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';
  const trapFocus = (container) => {
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const els = [...container.querySelectorAll(focusable)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  };

  let lockCount = 0;
  const lockScroll = () => {
    lockCount++;
    document.documentElement.classList.add('scroll-lock');
  };
  const unlockScroll = () => {
    lockCount = Math.max(0, lockCount - 1);
    if (!lockCount) document.documentElement.classList.remove('scroll-lock');
  };

  const toast = (message) => {
    const el = document.querySelector('[data-toast]');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('is-visible'), 2600);
  };

  const formatMoney = (cents) => {
    const format = theme.settings?.moneyFormat || '${{amount}}';
    const value = Number(cents) / 100;
    const fmt = (n, decimals, thousands = ',', dec = '.') => {
      const parts = n.toFixed(decimals).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return parts.join(dec);
    };
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals': return fmt(value, 0);
        case 'amount_with_comma_separator': return fmt(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return fmt(value, 0, '.', ',');
        case 'amount_with_apostrophe_separator': return fmt(value, 2, "'", '.');
        default: return fmt(value, 2);
      }
    });
  };

  const sectionUrl = (url, sectionId) => {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('section_id', sectionId);
    return u.toString();
  };

  const swapContent = (source, target, selector) => {
    const from = source.querySelector(selector);
    const to = target.querySelector(selector);
    if (from && to) to.innerHTML = from.innerHTML;
  };

  class SideDrawer extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) this.close();
      });
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.close();
      });
    }
    open(opener) {
      if (this.classList.contains('is-open')) return;
      this.opener = opener || document.activeElement;
      this.classList.add('is-open');
      this.setAttribute('aria-hidden', 'false');
      lockScroll();
      this.releaseTrap = trapFocus(this);
      const panel = this.querySelector('[tabindex="-1"]') || this;
      requestAnimationFrame(() => {
        const target = this.querySelector('[data-autofocus]') || panel;
        target.focus({ preventScroll: true });
      });
      this.dispatchEvent(new CustomEvent('drawer:open', { bubbles: true }));
    }
    close() {
      if (!this.classList.contains('is-open')) return;
      this.classList.remove('is-open');
      this.setAttribute('aria-hidden', 'true');
      unlockScroll();
      this.releaseTrap?.();
      this.opener?.focus?.({ preventScroll: true });
    }
  }
  customElements.define('side-drawer', SideDrawer);

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-drawer-open]');
    if (!opener) return;
    const drawer = document.getElementById(opener.dataset.drawerOpen);
    if (!drawer) return;
    if (opener.dataset.drawerOpen === 'CartDrawer' && theme.settings?.cartType !== 'drawer') return;
    e.preventDefault();
    drawer.open(opener);
  });

  class SearchModal extends SideDrawer {
    open(opener) {
      super.open(opener);
      setTimeout(() => this.querySelector('input[type="search"]')?.focus(), 50);
    }
  }
  customElements.define('search-modal', SearchModal);

  class PredictiveSearch extends HTMLElement {
    connectedCallback() {
      this.input = this.querySelector('input[type="search"]');
      this.results = this.querySelector('[data-results]');
      this.defaultContent = this.results?.innerHTML || '';
      this.cache = new Map();
      if (!this.input || !this.results) return;
      this.input.addEventListener('input', debounce(() => this.search(), 250));
      this.input.addEventListener('keydown', (e) => this.onKey(e));
    }
    async search() {
      const q = this.input.value.trim();
      if (!q) {
        this.results.innerHTML = this.defaultContent;
        this.input.setAttribute('aria-expanded', 'false');
        return;
      }
      if (this.cache.has(q)) return this.render(this.cache.get(q));
      this.abort?.abort();
      this.abort = new AbortController();
      try {
        const url = `${theme.routes.predictiveSearch}?q=${encodeURIComponent(q)}&section_id=predictive-search&resources[type]=product,collection,query,article,page&resources[limit]=8&resources[limit_scope]=each`;
        const res = await fetch(url, { signal: this.abort.signal });
        if (!res.ok) throw new Error(res.status);
        const html = parseHTML(await res.text()).querySelector('#shopify-section-predictive-search')?.innerHTML || '';
        this.cache.set(q, html);
        this.render(html);
      } catch (err) {
        if (err.name !== 'AbortError') this.results.innerHTML = this.defaultContent;
      }
    }
    render(html) {
      this.results.innerHTML = html;
      this.input.setAttribute('aria-expanded', 'true');
      this.index = -1;
    }
    onKey(e) {
      const items = [...this.results.querySelectorAll('[role="option"]')];
      if (!items.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
      if (e.key === 'Enter') {
        const sel = items[this.index];
        if (sel) {
          e.preventDefault();
          (sel.querySelector('a') || sel).click();
        }
        return;
      }
      e.preventDefault();
      this.index = e.key === 'ArrowDown' ? Math.min(items.length - 1, (this.index ?? -1) + 1) : Math.max(0, (this.index ?? 0) - 1);
      items.forEach((el, i) => el.setAttribute('aria-selected', i === this.index ? 'true' : 'false'));
      items[this.index]?.scrollIntoView({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', items[this.index]?.id || '');
    }
  }
  customElements.define('predictive-search', PredictiveSearch);

  class HeaderComponent extends HTMLElement {
    connectedCallback() {
      this.wrapper = this.closest('.header-wrapper') || this;
      this.sticky = this.wrapper.classList.contains('header-wrapper--sticky');
      this.smart = this.dataset.stickyMode === 'smart';
      this.lastY = window.scrollY;
      if (this.wrapper.classList.contains('header-wrapper--transparent')) document.body.classList.add('has-transparent-header');
      this.setHeight();
      window.addEventListener('resize', debounce(() => this.setHeight(), 150));
      window.addEventListener('scroll', () => this.onScroll(), { passive: true });
      this.onScroll();
      this.initMenus();
    }
    setHeight() {
      const h = this.querySelector('.header')?.offsetHeight || this.wrapper.offsetHeight;
      document.documentElement.style.setProperty('--header-h', `${this.sticky ? h : 0}px`);
      document.documentElement.style.setProperty('--header-h-static', `${h}px`);
    }
    onScroll() {
      const y = window.scrollY;
      this.wrapper.classList.toggle('is-scrolled', y > 10);
      if (this.sticky && this.smart) {
        const hide = y > this.lastY && y > this.wrapper.offsetHeight * 2 && !this.querySelector('.is-open');
        this.wrapper.classList.toggle('is-hidden', hide);
        document.documentElement.style.setProperty('--header-h', hide ? '0px' : `${this.wrapper.offsetHeight}px`);
      }
      this.lastY = y;
    }
    initMenus() {
      const items = [...this.querySelectorAll('.nav__item--has-children')];
      const closeAll = (except) => items.forEach((i) => {
        if (i !== except) {
          i.classList.remove('is-open');
          i.querySelector(':scope > .nav__link')?.setAttribute('aria-expanded', 'false');
        }
      });
      items.forEach((item) => {
        const trigger = item.querySelector(':scope > .nav__link');
        let timer;
        const open = () => {
          clearTimeout(timer);
          closeAll(item);
          item.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
        };
        const close = () => {
          timer = setTimeout(() => {
            item.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
          }, 120);
        };
        item.addEventListener('mouseenter', open);
        item.addEventListener('mouseleave', close);
        trigger.addEventListener('click', (e) => {
          if (trigger.tagName === 'BUTTON' || !item.classList.contains('is-open')) {
            e.preventDefault();
            item.classList.contains('is-open') ? (item.classList.remove('is-open'), trigger.setAttribute('aria-expanded', 'false')) : open();
          }
        });
        item.addEventListener('focusout', (e) => {
          if (!item.contains(e.relatedTarget)) close();
        });
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll();
      });
    }
  }
  customElements.define('header-component', HeaderComponent);

  class AnnouncementBar extends HTMLElement {
    connectedCallback() {
      this.slides = [...this.querySelectorAll('.announcement-bar__slide')];
      if (this.slides.length < 2) return;
      this.index = 0;
      this.querySelector('[data-prev]')?.addEventListener('click', () => this.go(this.index - 1, true));
      this.querySelector('[data-next]')?.addEventListener('click', () => this.go(this.index + 1, true));
      this.speed = (parseInt(this.dataset.speed, 10) || 5) * 1000;
      this.addEventListener('mouseenter', () => clearInterval(this.timer));
      this.addEventListener('mouseleave', () => this.play());
      this.play();
    }
    play() {
      clearInterval(this.timer);
      if (this.dataset.autoplay === 'true' && !reducedMotion) this.timer = setInterval(() => this.go(this.index + 1), this.speed);
    }
    go(i, user) {
      this.index = (i + this.slides.length) % this.slides.length;
      this.slides.forEach((s, n) => {
        s.classList.toggle('is-active', n === this.index);
        s.setAttribute('aria-hidden', n === this.index ? 'false' : 'true');
      });
      if (user) this.play();
    }
  }
  customElements.define('announcement-bar', AnnouncementBar);

  class SliderComponent extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('.slider__track');
      if (!this.track) return;
      const scope = this.closest('.shopify-section') || this;
      this.prev = scope.querySelector(`[data-slider-prev="${this.id}"]`) || this.querySelector('[data-slider-prev]');
      this.next = scope.querySelector(`[data-slider-next="${this.id}"]`) || this.querySelector('[data-slider-next]');
      this.progress = this.querySelector('.slider__progress span');
      this.prev?.addEventListener('click', () => this.scrollByPage(-1));
      this.next?.addEventListener('click', () => this.scrollByPage(1));
      this.track.addEventListener('scroll', debounce(() => this.update(), 40), { passive: true });
      new ResizeObserver(() => this.update()).observe(this.track);
      if (this.dataset.autoplay === 'true' && !reducedMotion) {
        const speed = (parseInt(this.dataset.speed, 10) || 5) * 1000;
        const tick = () => {
          const atEnd = this.track.scrollLeft + this.track.clientWidth >= this.track.scrollWidth - 4;
          atEnd ? this.track.scrollTo({ left: 0 }) : this.scrollByPage(1);
        };
        let timer = setInterval(tick, speed);
        this.addEventListener('mouseenter', () => clearInterval(timer));
        this.addEventListener('mouseleave', () => (timer = setInterval(tick, speed)));
      }
    }
    scrollByPage(dir) {
      const item = this.track.firstElementChild;
      if (!item) return;
      const gap = parseFloat(getComputedStyle(this.track).columnGap) || 0;
      const step = item.getBoundingClientRect().width + gap;
      const perPage = Math.max(1, Math.floor((this.track.clientWidth + gap) / step));
      this.track.scrollBy({ left: dir * step * perPage, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    update() {
      const { scrollLeft, scrollWidth, clientWidth } = this.track;
      const max = scrollWidth - clientWidth;
      if (this.prev) this.prev.disabled = scrollLeft <= 4;
      if (this.next) this.next.disabled = scrollLeft >= max - 4;
      if (this.progress) {
        const w = Math.min(100, (clientWidth / scrollWidth) * 100);
        this.progress.style.setProperty('--progress-w', `${w}%`);
        const pct = max > 0 ? scrollLeft / max : 0;
        this.progress.style.setProperty('--progress-x', `${pct * ((100 - w) / w) * 100}%`);
        this.progress.parentElement.hidden = max <= 4;
      }
    }
  }
  customElements.define('slider-component', SliderComponent);

  class SlideshowComponent extends HTMLElement {
    connectedCallback() {
      this.slides = [...this.querySelectorAll('.slideshow__slide')];
      this.bars = [...this.querySelectorAll('.slideshow__bar')];
      this.index = 0;
      if (this.slides.length < 2) return;
      this.speed = (parseInt(this.dataset.speed, 10) || 6) * 1000;
      this.style.setProperty('--speed', `${this.speed / 1000}s`);
      this.querySelector('[data-prev]')?.addEventListener('click', () => this.go(this.index - 1));
      this.querySelector('[data-next]')?.addEventListener('click', () => this.go(this.index + 1));
      this.bars.forEach((b, i) => b.addEventListener('click', () => this.go(i)));
      this.addEventListener('mouseenter', () => this.pause());
      this.addEventListener('mouseleave', () => this.play());
      this.addEventListener('focusin', () => this.pause());
      let startX = null;
      this.addEventListener('pointerdown', (e) => (startX = e.clientX));
      this.addEventListener('pointerup', (e) => {
        if (startX === null) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 50) this.go(this.index + (dx < 0 ? 1 : -1));
        startX = null;
      });
      document.addEventListener('shopify:block:select', (e) => {
        const i = this.slides.findIndex((s) => s.contains(e.target));
        if (i > -1) {
          this.go(i);
          this.pause();
        }
      });
      this.play();
    }
    play() {
      if (this.dataset.autoplay !== 'true' || reducedMotion) return;
      this.classList.remove('is-paused');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.go(this.index + 1), this.speed);
    }
    pause() {
      this.classList.add('is-paused');
      clearTimeout(this.timer);
    }
    go(i) {
      this.index = (i + this.slides.length) % this.slides.length;
      this.slides.forEach((s, n) => {
        const active = n === this.index;
        s.classList.toggle('is-active', active);
        s.toggleAttribute('inert', !active);
        s.querySelectorAll('video').forEach((v) => (active ? v.play().catch(() => {}) : v.pause()));
      });
      this.bars.forEach((b, n) => {
        b.setAttribute('aria-current', n === this.index ? 'true' : 'false');
        const span = b.querySelector('span');
        if (span) {
          span.style.animation = 'none';
          void span.offsetWidth;
          span.style.animation = '';
        }
      });
      if (!this.classList.contains('is-paused')) this.play();
    }
  }
  customElements.define('slideshow-component', SlideshowComponent);

  class TabsComponent extends HTMLElement {
    connectedCallback() {
      this.tabs = [...this.querySelectorAll('[role="tab"]')];
      this.tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => this.select(i));
        tab.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight') this.select((i + 1) % this.tabs.length, true);
          if (e.key === 'ArrowLeft') this.select((i - 1 + this.tabs.length) % this.tabs.length, true);
        });
      });
    }
    select(i, focus) {
      this.tabs.forEach((t, n) => {
        const on = n === i;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) this.tabs[i].focus();
    }
  }
  customElements.define('tabs-component', TabsComponent);

  class CountdownTimer extends HTMLElement {
    connectedCallback() {
      this.end = new Date(this.dataset.end).getTime();
      if (Number.isNaN(this.end)) return;
      this.units = {
        days: this.querySelector('[data-days]'),
        hours: this.querySelector('[data-hours]'),
        minutes: this.querySelector('[data-minutes]'),
        seconds: this.querySelector('[data-seconds]'),
      };
      this.tick();
      this.timer = setInterval(() => this.tick(), 1000);
    }
    disconnectedCallback() {
      clearInterval(this.timer);
    }
    tick() {
      let diff = Math.max(0, this.end - Date.now());
      const d = Math.floor(diff / 864e5);
      diff -= d * 864e5;
      const h = Math.floor(diff / 36e5);
      diff -= h * 36e5;
      const m = Math.floor(diff / 6e4);
      const s = Math.floor((diff - m * 6e4) / 1e3);
      const pad = (n) => String(n).padStart(2, '0');
      if (this.units.days) this.units.days.textContent = pad(d);
      if (this.units.hours) this.units.hours.textContent = pad(h);
      if (this.units.minutes) this.units.minutes.textContent = pad(m);
      if (this.units.seconds) this.units.seconds.textContent = pad(s);
      if (this.end - Date.now() <= 0) {
        clearInterval(this.timer);
        if (this.dataset.hideOnEnd === 'true') this.closest('.shopify-section')?.setAttribute('hidden', '');
      }
    }
  }
  customElements.define('countdown-timer', CountdownTimer);

  const Cart = {
    sectionIds() {
      const ids = [...document.querySelectorAll('[data-cart-render]')].map((el) => el.dataset.cartRender);
      return [...new Set(ids)].slice(0, 5);
    },
    render(sections) {
      if (!sections) return;
      Object.entries(sections).forEach(([id, html]) => {
        if (!html) return;
        const doc = parseHTML(html);
        document.querySelectorAll(`[data-cart-render="${id}"]`).forEach((target) => {
          const source = doc.querySelector(`[data-cart-render="${id}"]`);
          if (source) target.innerHTML = source.innerHTML;
        });
        const count = doc.querySelector('[data-item-count]');
        if (count) this.setCount(count.dataset.itemCount);
      });
    },
    setCount(n) {
      document.querySelectorAll('[data-cart-count]').forEach((el) => {
        el.textContent = Number(n) > 0 ? n : '';
      });
    },
    async change(line, quantity) {
      const res = await fetch(`${theme.routes.cartChange}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ line, quantity, sections: this.sectionIds(), sections_url: window.location.pathname }),
      });
      const data = await res.json();
      if (!res.ok || data.status) throw new Error(data.description || data.message || theme.strings.cartError);
      this.render(data.sections);
      this.setCount(data.item_count);
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: data }));
      return data;
    },
    async add(formData) {
      const sections = this.sectionIds();
      if (sections.length) {
        formData.append('sections', sections.join(','));
        formData.append('sections_url', window.location.pathname);
      }
      const res = await fetch(`${theme.routes.cartAdd}.js`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.status) throw new Error(data.description || data.message || theme.strings.cartError);
      this.render(data.sections);
      document.dispatchEvent(new CustomEvent('cart:added', { detail: data }));
      return data;
    },
    afterAdd(opener) {
      const drawer = document.getElementById('CartDrawer');
      document.getElementById('QuickView')?.close?.();
      if (theme.settings.cartType === 'drawer' && drawer) {
        drawer.open(opener);
      } else if (!document.body.classList.contains('template-cart')) {
        window.location.href = theme.routes.cart;
      }
    },
  };
  window.theme.cart = Cart;

  class ProductForm extends HTMLElement {
    connectedCallback() {
      this.form = this.querySelector('form');
      if (!this.form) return;
      this.form.addEventListener('submit', (e) => this.onSubmit(e));
      this.error = this.querySelector('[data-form-error]');
    }
    async onSubmit(e) {
      e.preventDefault();
      const submitter = e.submitter || this.form.querySelector('[type="submit"]');
      const buttons = document.querySelectorAll(`[form="${this.form.id}"][type="submit"], #${this.form.id} [type="submit"]`);
      if (submitter?.getAttribute('aria-disabled') === 'true') return;
      buttons.forEach((b) => b.classList.add('loading'));
      if (this.error) this.error.hidden = true;
      try {
        await Cart.add(new FormData(this.form));
        Cart.afterAdd(submitter);
      } catch (err) {
        if (this.error) {
          this.error.textContent = err.message;
          this.error.hidden = false;
        } else toast(err.message);
      } finally {
        buttons.forEach((b) => b.classList.remove('loading'));
      }
    }
  }
  customElements.define('product-form', ProductForm);

  class CartItems extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-qty-change], [data-remove]');
        if (!btn) return;
        e.preventDefault();
        const item = btn.closest('[data-line]');
        const input = item.querySelector('.qty__input');
        let qty = btn.hasAttribute('data-remove') ? 0 : Number(input.value) + Number(btn.dataset.qtyChange);
        this.update(item, Math.max(0, qty));
      });
      this.addEventListener('change', (e) => {
        const input = e.target.closest('.qty__input');
        if (input) this.update(input.closest('[data-line]'), Math.max(0, Number(input.value)));
      });
    }
    async update(item, qty) {
      item.classList.add('is-loading');
      try {
        await Cart.change(Number(item.dataset.line), qty);
      } catch (err) {
        toast(err.message);
        item.classList.remove('is-loading');
      }
    }
  }
  customElements.define('cart-items', CartItems);

  document.addEventListener('input', debounce((e) => {
    const note = e.target.closest('[data-cart-note]');
    if (!note) return;
    fetch(`${theme.routes.cartUpdate}.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ note: note.value }),
    });
  }, 500));

  document.addEventListener('change', (e) => {
    const terms = e.target.closest('[data-cart-terms]');
    if (terms) {
      terms.closest('form')?.querySelectorAll('[name="checkout"]').forEach((b) => (b.disabled = !terms.checked));
    }
    const loc = e.target.closest('[data-localization-select]');
    if (loc) loc.form.submit();
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quick-add]');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.variantId) {
      btn.classList.add('loading');
      const fd = new FormData();
      fd.append('id', btn.dataset.variantId);
      fd.append('quantity', '1');
      try {
        await Cart.add(fd);
        Cart.afterAdd(btn);
      } catch (err) {
        toast(err.message);
      } finally {
        btn.classList.remove('loading');
      }
      return;
    }
    document.getElementById('QuickView')?.load(btn.dataset.productUrl, btn);
  });

  class QuickViewModal extends HTMLElement {
    connectedCallback() {
      this.content = this.querySelector('[data-quick-view-content]');
      this.panel = this.querySelector('.modal__panel');
      this.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) this.close();
      });
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.close();
      });
    }
    async load(url, opener) {
      this.opener = opener;
      this.content.innerHTML = '<div class="quick-view"><div class="skeleton" style="aspect-ratio:4/5"></div><div style="display:grid;gap:1rem;align-content:start"><div class="skeleton" style="height:2.5rem;width:70%"></div><div class="skeleton" style="height:1.5rem;width:30%"></div><div class="skeleton" style="height:8rem"></div><div class="skeleton" style="height:3.25rem"></div></div></div>';
      this.open();
      try {
        const res = await fetch(sectionUrl(url, 'quick-view'));
        const doc = parseHTML(await res.text());
        const html = doc.querySelector('[data-quick-view]');
        this.content.innerHTML = html ? html.outerHTML : '';
        this.panel.focus();
      } catch {
        this.close();
        window.location.href = url;
      }
    }
    open() {
      this.hidden = false;
      lockScroll();
      this.releaseTrap = trapFocus(this);
      this.panel.focus();
    }
    close() {
      if (this.hidden) return;
      this.hidden = true;
      unlockScroll();
      this.releaseTrap?.();
      this.opener?.focus?.();
    }
  }
  customElements.define('quick-view-modal', QuickViewModal);

  class VariantPicker extends HTMLElement {
    connectedCallback() {
      this.addEventListener('change', (e) => this.onChange(e));
    }
    get container() {
      return this.closest('[data-product]');
    }
    selectedValueIds() {
      return [...this.querySelectorAll('input:checked, select')].map((el) => (el.tagName === 'SELECT' ? el.selectedOptions[0].dataset.optionValueId : el.dataset.optionValueId));
    }
    async onChange(e) {
      const target = e.target;
      const selected = target.tagName === 'SELECT' ? target.selectedOptions[0] : target;
      target.closest('.option')?.querySelector('[data-selected-value]')?.replaceChildren(selected.value);
      const container = this.container;
      const sectionId = this.dataset.sectionId;
      const productUrl = selected.dataset.productUrl || this.dataset.url;
      const productChanged = selected.dataset.productUrl && selected.dataset.productUrl !== this.dataset.url;
      const ids = this.selectedValueIds().join(',');
      this.abort?.abort();
      this.abort = new AbortController();
      container.classList.add('is-updating');
      try {
        const url = `${productUrl}?${productChanged ? '' : `option_values=${ids}&`}section_id=${sectionId}`;
        const res = await fetch(url, { signal: this.abort.signal });
        const doc = parseHTML(await res.text());
        if (productChanged) {
          const newContainer = doc.querySelector('[data-product]');
          if (newContainer) container.innerHTML = newContainer.innerHTML;
          if (this.dataset.updateUrl === 'true') window.history.replaceState({}, '', productUrl);
          return;
        }
        container.querySelectorAll('[data-swap]').forEach((el) => {
          const fresh = doc.querySelector(`[data-swap="${el.dataset.swap}"]`);
          if (fresh) el.innerHTML = fresh.innerHTML;
          if (fresh) [...fresh.attributes].forEach((a) => a.name !== 'data-swap' && el.setAttribute(a.name, a.value));
        });
        const variantEl = doc.querySelector('[data-variant-json]');
        const variant = variantEl ? JSON.parse(variantEl.textContent) : null;
        const form = container.querySelector('form[data-type="add-to-cart-form"]');
        const idInput = form?.querySelector('input[name="id"]');
        if (variant && idInput) {
          idInput.value = variant.id;
          idInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (variant && this.dataset.updateUrl === 'true') {
          const u = new URL(window.location.href);
          u.searchParams.set('variant', variant.id);
          window.history.replaceState({}, '', u.toString());
        }
        if (variant?.featured_media) container.querySelector('media-gallery')?.goToMedia(variant.featured_media.id);
        document.dispatchEvent(new CustomEvent('variant:change', { detail: { variant, sectionId } }));
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
      } finally {
        container.classList.remove('is-updating');
      }
    }
  }
  customElements.define('variant-picker', VariantPicker);

  class MediaGallery extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('.gallery__track');
      this.items = [...this.querySelectorAll('.gallery__item')];
      this.thumbs = [...this.querySelectorAll('.gallery__thumb')];
      this.counter = this.querySelector('[data-counter]');
      if (!this.track) return;
      this.thumbs.forEach((t, i) => t.addEventListener('click', () => this.go(i)));
      this.querySelector('[data-prev]')?.addEventListener('click', () => this.go(this.current() - 1));
      this.querySelector('[data-next]')?.addEventListener('click', () => this.go(this.current() + 1));
      this.track.addEventListener('scroll', debounce(() => this.sync(), 60), { passive: true });
      const initial = this.items.findIndex((el) => el.dataset.mediaId === this.dataset.initialMedia);
      if (initial > 0) {
        requestAnimationFrame(() => {
          if (getComputedStyle(this.track).display !== 'grid') this.track.scrollLeft = this.items[initial].offsetLeft - this.track.offsetLeft;
          this.setActive(initial);
        });
      }
      if (this.dataset.zoom === 'true') {
        this.track.addEventListener('keydown', (e) => {
          const media = e.target.closest('[data-zoom-src]');
          if (media && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            this.openLightbox(this.items.indexOf(media.closest('.gallery__item')));
          }
        });
        this.track.addEventListener('click', (e) => {
          const media = e.target.closest('[data-zoom-src]');
          if (media) this.openLightbox(this.items.indexOf(media.closest('.gallery__item')));
        });
      }
    }
    current() {
      const w = this.track.clientWidth || 1;
      return Math.round(this.track.scrollLeft / w);
    }
    go(i) {
      const n = Math.max(0, Math.min(this.items.length - 1, i));
      const item = this.items[n];
      if (!item) return;
      if (getComputedStyle(this.track).display === 'grid') {
        item.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      } else {
        this.track.scrollTo({ left: item.offsetLeft - this.track.offsetLeft, behavior: reducedMotion ? 'auto' : 'smooth' });
      }
      this.setActive(n);
    }
    goToMedia(id) {
      const i = this.items.findIndex((el) => el.dataset.mediaId === String(id));
      if (i > -1) this.go(i);
    }
    sync() {
      this.setActive(this.current());
    }
    setActive(n) {
      this.thumbs.forEach((t, i) => t.setAttribute('aria-current', i === n ? 'true' : 'false'));
      this.thumbs[n]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (this.counter) this.counter.textContent = `${n + 1} / ${this.items.length}`;
      this.items.forEach((el, i) => {
        if (i !== n) el.querySelectorAll('video').forEach((v) => v.pause());
      });
    }
    openLightbox(start) {
      const sources = [...this.querySelectorAll('[data-zoom-src]')];
      if (!sources.length) return;
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.tabIndex = -1;
      box.innerHTML = `<button type="button" class="icon-button lightbox__close" aria-label="Close"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="lightbox__track">${sources.map((s) => `<div class="lightbox__item"><img src="${s.dataset.zoomSrc}" alt="${s.dataset.alt || ''}" loading="lazy"></div>`).join('')}</div>
        <div class="lightbox__nav"><button type="button" class="slider__btn" data-lb-prev aria-label="Previous"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 6l-6 6 6 6"/></svg></button><span data-lb-count></span><button type="button" class="slider__btn" data-lb-next aria-label="Next"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
      document.body.appendChild(box);
      lockScroll();
      const track = box.querySelector('.lightbox__track');
      const count = box.querySelector('[data-lb-count]');
      const idx = Math.max(0, sources.findIndex((s) => s.closest('.gallery__item') === this.items[start]));
      const update = () => (count.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1} / ${sources.length}`);
      requestAnimationFrame(() => {
        track.scrollLeft = track.clientWidth * idx;
        update();
      });
      track.addEventListener('scroll', debounce(update, 50));
      const step = (d) => track.scrollBy({ left: d * track.clientWidth, behavior: 'smooth' });
      box.querySelector('[data-lb-prev]').addEventListener('click', () => step(-1));
      box.querySelector('[data-lb-next]').addEventListener('click', () => step(1));
      const release = trapFocus(box);
      const close = () => {
        release();
        box.remove();
        unlockScroll();
        this.items[start]?.querySelector('[data-zoom-src]')?.focus?.();
      };
      box.querySelector('.lightbox__close').addEventListener('click', close);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowRight') step(1);
        if (e.key === 'ArrowLeft') step(-1);
      });
      track.addEventListener('click', (e) => {
        const item = e.target.closest('.lightbox__item');
        if (!item) return;
        const rect = item.getBoundingClientRect();
        item.style.setProperty('--ox', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        item.style.setProperty('--oy', `${((e.clientY - rect.top) / rect.height) * 100}%`);
        item.classList.toggle('is-zoomed');
      });
      track.addEventListener('mousemove', (e) => {
        const item = e.target.closest('.lightbox__item.is-zoomed');
        if (!item) return;
        const rect = item.getBoundingClientRect();
        item.style.setProperty('--ox', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        item.style.setProperty('--oy', `${((e.clientY - rect.top) / rect.height) * 100}%`);
      });
      box.focus();
    }
  }
  customElements.define('media-gallery', MediaGallery);

  class DeferredMedia extends HTMLElement {
    connectedCallback() {
      this.querySelector('[data-load]')?.addEventListener('click', () => this.load());
      if (this.dataset.autoload === 'true') {
        const io = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            this.load();
            io.disconnect();
          }
        });
        io.observe(this);
      }
    }
    load() {
      if (this.loaded) return;
      const tpl = this.querySelector('template');
      if (!tpl) return;
      this.loaded = true;
      const content = tpl.content.cloneNode(true);
      this.querySelector('[data-load]')?.remove();
      this.appendChild(content);
      const el = this.querySelector('video, iframe');
      if (el?.tagName === 'VIDEO') el.play().catch(() => {});
    }
  }
  customElements.define('deferred-media', DeferredMedia);

  class StickyAtc extends HTMLElement {
    connectedCallback() {
      const target = document.querySelector(this.dataset.target);
      if (!target) return;
      const footer = document.querySelector('.footer');
      let past = false;
      let atFooter = false;
      const update = () => {
        const show = past && !atFooter;
        this.classList.toggle('is-visible', show);
        this.setAttribute('aria-hidden', show ? 'false' : 'true');
        this.toggleAttribute('inert', !show);
      };
      new IntersectionObserver(([entry]) => {
        past = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        update();
      }).observe(target);
      if (footer) {
        new IntersectionObserver(([entry]) => {
          atFooter = entry.isIntersecting;
          update();
        }).observe(footer);
      }
      this.querySelector('[data-sticky-variant]')?.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        const formId = this.dataset.form;
        const form = document.getElementById(formId);
        const input = form?.querySelector('input[name="id"]');
        if (input) input.value = opt.value;
        const price = this.querySelector('[data-sticky-price]');
        if (price) price.innerHTML = opt.dataset.price;
        const btn = this.querySelector('[type="submit"]');
        if (btn) {
          const available = opt.dataset.available === 'true';
          btn.setAttribute('aria-disabled', available ? 'false' : 'true');
          btn.disabled = !available;
          btn.querySelector('span').textContent = available ? theme.strings.addToCart : theme.strings.soldOut;
        }
      });
    }
  }
  customElements.define('sticky-atc', StickyAtc);

  class ShareButton extends HTMLElement {
    connectedCallback() {
      this.querySelector('button')?.addEventListener('click', async () => {
        const data = { title: document.title, url: this.dataset.url || window.location.href };
        if (navigator.share) {
          try {
            await navigator.share(data);
          } catch {}
        } else {
          await navigator.clipboard?.writeText(data.url);
          toast(theme.strings.copied);
        }
      });
    }
  }
  customElements.define('share-button', ShareButton);

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    await navigator.clipboard?.writeText(btn.dataset.copy);
    toast(theme.strings.copied);
  });

  class DeliveryEstimate extends HTMLElement {
    connectedCallback() {
      const min = parseInt(this.dataset.min, 10) || 3;
      const max = parseInt(this.dataset.max, 10) || 7;
      const cutoff = parseInt(this.dataset.cutoff, 10);
      const skipWeekends = this.dataset.skipWeekends === 'true';
      const addDays = (n) => {
        const d = new Date();
        let added = 0;
        while (added < n) {
          d.setDate(d.getDate() + 1);
          if (!skipWeekends || (d.getDay() !== 0 && d.getDay() !== 6)) added++;
        }
        return d;
      };
      const fmt = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const range = this.querySelector('[data-range]');
      if (range) range.textContent = `${fmt.format(addDays(min))} – ${fmt.format(addDays(max))}`;
      const timer = this.querySelector('[data-cutoff-timer]');
      if (timer && !Number.isNaN(cutoff)) {
        const tick = () => {
          const now = new Date();
          const end = new Date();
          end.setHours(cutoff, 0, 0, 0);
          if (now >= end) end.setDate(end.getDate() + 1);
          const diff = end - now;
          const h = Math.floor(diff / 36e5);
          const m = Math.floor((diff % 36e5) / 6e4);
          timer.textContent = `${h}h ${String(m).padStart(2, '0')}m`;
        };
        tick();
        setInterval(tick, 30000);
      }
    }
  }
  customElements.define('delivery-estimate', DeliveryEstimate);

  const RV_KEY = 'theme:recently-viewed';
  const readRV = () => {
    try {
      return JSON.parse(localStorage.getItem(RV_KEY)) || [];
    } catch {
      return [];
    }
  };
  class RecentlyViewedTracker extends HTMLElement {
    connectedCallback() {
      const handle = this.dataset.handle;
      if (!handle) return;
      try {
        const list = [handle, ...readRV().filter((h) => h !== handle)].slice(0, 12);
        localStorage.setItem(RV_KEY, JSON.stringify(list));
      } catch {}
    }
  }
  customElements.define('recently-viewed-tracker', RecentlyViewedTracker);

  class RecentlyViewed extends HTMLElement {
    async connectedCallback() {
      const limit = parseInt(this.dataset.limit, 10) || 4;
      const handles = readRV().filter((h) => h !== this.dataset.exclude).slice(0, limit);
      const list = this.querySelector('[data-items]');
      if (!handles.length || !list) {
        this.setAttribute('data-empty', '');
        return;
      }
      const results = await Promise.all(handles.map(async (h) => {
        try {
          const res = await fetch(`${theme.routes.root.replace(/\/$/, '')}/products/${h}?section_id=product-card`);
          if (!res.ok) return '';
          const card = parseHTML(await res.text()).querySelector('[data-card]');
          return card ? `<li>${card.outerHTML}</li>` : '';
        } catch {
          return '';
        }
      }));
      const html = results.filter(Boolean).join('');
      if (!html) {
        this.setAttribute('data-empty', '');
        return;
      }
      this.removeAttribute('data-empty');
      list.innerHTML = html;
      this.hidden = false;
    }
  }
  customElements.define('recently-viewed', RecentlyViewed);

  class ProductRecommendations extends HTMLElement {
    connectedCallback() {
      if (!this.dataset.url) return;
      const io = new IntersectionObserver(async (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        try {
          const res = await fetch(this.dataset.url);
          const doc = parseHTML(await res.text());
          const fresh = doc.querySelector(`product-recommendations[data-section-id="${this.dataset.sectionId}"]`);
          if (fresh && fresh.querySelector('[data-card], .upsell-item')) {
            this.innerHTML = fresh.innerHTML;
          } else if (this.dataset.hideEmpty === 'true') {
            this.closest('.shopify-section, [data-recs-wrapper]')?.setAttribute('hidden', '');
          }
        } catch {}
      }, { rootMargin: '0px 0px 400px 0px' });
      io.observe(this);
    }
  }
  customElements.define('product-recommendations', ProductRecommendations);

  class FacetFilters extends HTMLElement {
    connectedCallback() {
      this.sectionId = this.dataset.sectionId;
      this.form = this.querySelector('form[data-facets-form]') || document.getElementById(this.dataset.form);
      this.addEventListener('input', debounce((e) => {
        if (e.target.closest('form[data-facets-form]') || e.target.form?.hasAttribute('data-facets-form')) this.submit();
      }, 450));
      this.addEventListener('click', (e) => {
        const link = e.target.closest('[data-facet-link]');
        if (!link) return;
        e.preventDefault();
        this.render(new URL(link.href, window.location.origin).searchParams.toString());
      });
      this.addEventListener('submit', (e) => {
        if (!e.target.matches('[data-facets-form]')) return;
        e.preventDefault();
        this.submit();
      });
      window.addEventListener('popstate', (e) => {
        if (e.state?.facets !== undefined) this.render(e.state.facets, false);
      });
      this.initGridToggle();
    }
    params() {
      const forms = document.querySelectorAll('[data-facets-form]');
      const params = new URLSearchParams();
      forms.forEach((form) => {
        new FormData(form).forEach((v, k) => {
          if (v === '') return;
          if (k.startsWith('filter.v.price') && !v) return;
          params.append(k, v);
        });
      });
      return params.toString();
    }
    submit() {
      this.render(this.params());
    }
    async render(query, push = true) {
      const grid = this.querySelector('[data-product-grid]');
      grid?.classList.add('is-loading');
      try {
        const res = await fetch(`${window.location.pathname}?${query}${query ? '&' : ''}section_id=${this.sectionId}`);
        const doc = parseHTML(await res.text());
        ['[data-facet-render="grid"]', '[data-facet-render="active"]', '[data-facet-render="count"]', '[data-facet-render="pagination"]'].forEach((sel) => swapContent(doc, this, sel));
        doc.querySelectorAll('[data-facet-render="facets"] .facet').forEach((fresh) => {
          const current = this.querySelector(`.facet[data-facet-id="${fresh.dataset.facetId}"]`);
          if (!current) return;
          const wasOpen = current.open;
          const body = fresh.querySelector('.facet__body');
          const currBody = current.querySelector('.facet__body');
          const active = document.activeElement;
          if (body && currBody && !currBody.contains(active)) currBody.innerHTML = body.innerHTML;
          const sum = fresh.querySelector('.facet__summary');
          if (sum) current.querySelector('.facet__summary').innerHTML = sum.innerHTML;
          current.open = wasOpen;
        });
        const total = doc.querySelector('[data-results-count]');
        this.querySelectorAll('[data-results-count]').forEach((el) => total && (el.textContent = total.textContent));
        if (push) window.history.pushState({ facets: query }, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        this.applyGrid();
      } finally {
        this.querySelector('[data-product-grid]')?.classList.remove('is-loading');
      }
    }
    initGridToggle() {
      this.querySelectorAll('[data-grid-cols]').forEach((btn) => btn.addEventListener('click', () => {
        try {
          localStorage.setItem('theme:grid-cols', btn.dataset.gridCols);
        } catch {}
        this.applyGrid();
      }));
      this.applyGrid();
    }
    applyGrid() {
      let cols;
      try {
        cols = localStorage.getItem('theme:grid-cols');
      } catch {}
      const grid = this.querySelector('[data-product-grid]');
      if (!grid || !cols) return;
      grid.dataset.cols = cols;
      this.querySelectorAll('[data-grid-cols]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gridCols === cols ? 'true' : 'false'));
    }
  }
  customElements.define('facet-filters', FacetFilters);

  class LoadMore extends HTMLElement {
    connectedCallback() {
      this.button = this.querySelector('button');
      this.button?.addEventListener('click', () => this.load());
      if (this.dataset.infinite === 'true') {
        this.io = new IntersectionObserver((e) => e[0].isIntersecting && this.load(), { rootMargin: '0px 0px 600px 0px' });
        this.io.observe(this);
      }
    }
    async load() {
      const next = this.dataset.nextUrl;
      if (!next || this.loading) return;
      this.loading = true;
      this.button?.classList.add('loading');
      try {
        const res = await fetch(sectionUrl(next, this.dataset.sectionId));
        const doc = parseHTML(await res.text());
        const grid = document.querySelector(`#${this.dataset.grid}`);
        const freshGrid = doc.querySelector(`#${this.dataset.grid}`);
        freshGrid?.querySelectorAll(':scope > *').forEach((el) => grid.appendChild(el));
        const freshMore = doc.querySelector('load-more');
        if (freshMore) {
          this.innerHTML = freshMore.innerHTML;
          this.dataset.nextUrl = freshMore.dataset.nextUrl || '';
          this.button = this.querySelector('button');
          this.button?.addEventListener('click', () => this.load());
        }
        if (!this.dataset.nextUrl) {
          this.io?.disconnect();
          this.button?.remove();
        }
        revealAll();
      } finally {
        this.loading = false;
        this.button?.classList.remove('loading');
      }
    }
  }
  customElements.define('load-more', LoadMore);

  class ShopTheLook extends HTMLElement {
    connectedCallback() {
      this.spots = [...this.querySelectorAll('.hotspot')];
      this.rows = [...this.querySelectorAll('.lookbook__product')];
      this.spots.forEach((spot, i) => {
        spot.querySelector('.hotspot__btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activate(spot.classList.contains('is-active') ? -1 : i);
        });
        spot.addEventListener('mouseenter', () => window.matchMedia('(hover:hover)').matches && this.activate(i));
      });
      this.rows.forEach((row, i) => row.addEventListener('mouseenter', () => this.activate(i)));
      document.addEventListener('click', (e) => {
        if (!this.contains(e.target)) this.activate(-1);
      });
    }
    activate(i) {
      this.spots.forEach((s, n) => {
        s.classList.toggle('is-active', n === i);
        s.querySelector('.hotspot__btn')?.setAttribute('aria-expanded', n === i ? 'true' : 'false');
      });
      this.rows.forEach((r, n) => r.classList.toggle('is-active', n === i));
    }
  }
  customElements.define('shop-the-look', ShopTheLook);

  class ModalOpener extends HTMLElement {
    connectedCallback() {
      this.querySelector('button')?.addEventListener('click', () => {
        const dialog = document.getElementById(this.dataset.modal);
        if (!dialog) return;
        if (!dialog.dataset.bound) {
          dialog.dataset.bound = 'true';
          dialog.addEventListener('click', (e) => {
            if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
          });
        }
        dialog.showModal();
      });
    }
  }
  customElements.define('modal-opener', ModalOpener);

  document.addEventListener('mouseover', (e) => {
    const swatch = e.target.closest('.card__swatch[data-swatch-image]');
    if (!swatch || swatch.classList.contains('is-active')) return;
    const card = swatch.closest('[data-card]');
    const img = card?.querySelector('.card__media img:not(.card__img-hover)');
    if (!img) return;
    card.querySelectorAll('.card__swatch').forEach((s) => s.classList.toggle('is-active', s === swatch));
    img.removeAttribute('srcset');
    img.src = swatch.dataset.swatchImage;
  });

  let revealObserver;
  const revealAll = () => {
    if (!document.body.classList.contains('has-reveal') || !('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
      return;
    }
    revealObserver = revealObserver || new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    document.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => revealObserver.observe(el));
  };
  document.addEventListener('DOMContentLoaded', () => {
    revealAll();
    document.querySelectorAll('select[data-default]').forEach((el) => {
      if (el.dataset.default) el.value = el.dataset.default;
    });
  });
  document.addEventListener('shopify:section:load', revealAll);
  if (window.Shopify?.designMode) document.body?.classList.add('shopify-design-mode');

  window.theme.utils = { debounce, toast, formatMoney, parseHTML, revealAll };
})();

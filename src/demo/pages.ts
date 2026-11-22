/**
 * The built-in demo app. It is a static, dependency-free storefront that shows
 * the failure modes agent-eye measures: an overlay covering a primary action,
 * three controls with the identical label, icon buttons with no name, a live
 * ticker, and a toggle wired to nothing. `/checkout-clean` is the same store
 * after the fixes.
 */

const STYLE = `
  :root { --ink:#12161c; --muted:#66707c; --line:#e5e8ec; --accent:#0b62d6; --bg:#f7f8fa; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif; color:var(--ink); background:var(--bg); }
  header.topbar { display:flex; align-items:center; gap:18px; padding:12px 22px; background:#fff; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:3; }
  .brand { font-weight:700; text-decoration:none; color:var(--ink); margin-right:8px; }
  nav a { color:var(--muted); margin-right:14px; text-decoration:none; font-size:14px; }
  .icon { width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--line); background:#fff; border-radius:8px; cursor:pointer; }
  .icon svg { width:16px; height:16px; stroke:var(--ink); fill:none; stroke-width:1.7; }
  main { max-width:880px; margin:0 auto; padding:26px 20px 140px; }
  h1 { font-size:24px; margin:0 0 4px; letter-spacing:-0.01em; }
  .lede { color:var(--muted); margin:0 0 22px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; }
  .card h2 { font-size:15px; margin:0 0 4px; }
  .card p { color:var(--muted); font-size:13px; margin:0 0 12px; }
  .card .price { font-weight:600; display:block; margin-bottom:10px; }
  .card button { width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
  .ticker { margin:22px 0; padding:10px 14px; background:#fff4d6; border:1px solid #f0dfa8; border-radius:10px; font-size:13.5px; }
  .faq { margin-top:26px; }
  .faq button { width:100%; text-align:left; padding:11px 12px; background:#fff; border:1px solid var(--line); border-radius:10px; margin-bottom:8px; cursor:pointer; font-weight:600; }
  .faq .panel { padding:0 14px 14px; color:var(--muted); font-size:13.5px; }
  .prose p { color:#3a434e; font-size:14px; }
  .checkout-bar { position:fixed; left:0; right:0; bottom:0; background:#fff; border-top:1px solid var(--line); padding:12px 22px; display:flex; gap:10px; justify-content:flex-end; z-index:4; }
  .checkout-bar button { padding:11px 18px; border-radius:9px; border:1px solid var(--line); background:#fff; font-weight:600; cursor:pointer; }
  .checkout-bar .primary { background:var(--ink); color:#fff; border-color:var(--ink); }
  .cookie { position:fixed; left:0; right:0; bottom:0; z-index:9; background:#101418; color:#f2f5f8; padding:16px 22px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  .cookie p { margin:0; flex:1 1 320px; font-size:13.5px; color:#c8d0d8; }
  .cookie button { padding:9px 14px; border-radius:8px; border:1px solid #3a4552; background:#1b222b; color:#e8edf2; cursor:pointer; font-weight:600; }
  .cookie button.primary { background:#fff; color:#101418; border-color:#fff; }
  .visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
  .offscreen { position:absolute; left:-9999px; top:0; }
  footer { color:var(--muted); font-size:12.5px; padding:22px; text-align:center; }
  .cart-count { font-weight:700; }
  .menu { background:#fff; border:1px solid var(--line); border-radius:10px; padding:8px; position:absolute; right:22px; top:56px; z-index:5; }
`;

const PRODUCTS = [
  {
    id: "headphones",
    name: "Aria Headphones",
    price: "$249",
    blurb: "Closed-back wireless headphones with 40h battery and a detachable cable.",
  },
  {
    id: "speaker",
    name: "Nimbus Speaker",
    price: "$129",
    blurb: "Room-filling sound in a 1.2kg body, with a linen grille and a physical volume dial.",
  },
  {
    id: "turntable",
    name: "Orbit Turntable",
    price: "$389",
    blurb: "Belt-driven turntable with a pre-mounted cartridge and a built-in phono stage.",
  },
];

const PROSE = [
  "Every order ships from our Rotterdam warehouse within two business days. Tracking arrives by email as soon as the parcel is scanned by the carrier, and the same tracking page lists the delivery window in your local time.",
  "Returns are open for thirty days from delivery. The item needs to be in resalable condition and the original packaging helps, though it is not required. We pay return shipping on defective units, and the customer pays it on change-of-mind returns.",
  "Warranty coverage runs for two years on electronics and five years on the turntable's motor assembly. Warranty claims start with a short form; most are answered within a working day, and repairs are handled by the nearest authorised service partner.",
  "Payment is processed by our payment provider. Card details never touch our servers, and the checkout uses a hosted field that is scoped to the payment session. Saved cards are tokenised per customer account and can be removed from the account page at any time.",
  "Accessories are listed alongside each product. Cables, replacement ear pads, and dust covers are stocked year-round. If an accessory is out of stock, the product page offers a notify-me option that sends one email when it returns.",
  "Gift orders can include a handwritten note. The note is printed on recycled card stock and tucked into the parcel, and the invoice is sent by email instead of being included in the box.",
  "Business customers can request a VAT invoice from the order history page. The invoice is generated as a PDF within a minute and is also available through the customer API for automated bookkeeping.",
  "Our support team answers in English, Dutch, and German between 09:00 and 18:00 CET on weekdays. Outside those hours, the help centre covers the common questions, and the contact form queues a reply for the next working morning.",
];

function productCards(label: string): string {
  return PRODUCTS.map(
    (product) => `
      <article class="card" data-product="${product.id}">
        <h2>${product.name}</h2>
        <p>${product.blurb}</p>
        <span class="price">${product.price}</span>
        <button type="button" data-add="${product.id}">${label === "unique" ? `Add the ${product.name} to cart` : "Add to cart"}</button>
      </article>`,
  ).join("\n");
}

function prose(): string {
  return `<div class="prose">${PROSE.map((paragraph) => `<p>${paragraph}</p>`).join("\n")}</div>`;
}

const NOISY_SCRIPT = `
  const count = document.getElementById('cart-count');
  document.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      count.textContent = String(Number(count.textContent || '0') + 1);
      const notice = document.getElementById('cart-notice');
      notice.hidden = false;
      notice.textContent = 'Added to your cart.';
    });
  });
  document.querySelectorAll('.acc').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = document.getElementById(button.dataset.panel);
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
  });
  // .acc-broken has no handler: it accepts a click and changes nothing.
  setInterval(() => {
    document.getElementById('clock').textContent = new Date().toISOString().slice(11, 23);
  }, 120);
  const promos = ['Free shipping over $150', 'Bundle the headphones and save 10%', 'Only 4 turntables left', 'Gift wrapping is free this week'];
  let promoIndex = 0;
  setInterval(() => {
    promoIndex = (promoIndex + 1) % promos.length;
    document.getElementById('promo').textContent = promos[promoIndex];
  }, 600);
  // Two icon buttons with no accessible name and no visible label.
  document.getElementById('icon-search').addEventListener('click', () => {});
  document.getElementById('icon-account').addEventListener('click', () => {});
  // Checkout bar buttons are covered by the cookie banner.
  document.getElementById('place-order').addEventListener('click', () => {
    document.getElementById('cart-notice').textContent = 'Order placed.';
  });
  document.getElementById('gift-card').addEventListener('click', () => {
    document.getElementById('cart-notice').textContent = 'Gift card applied.';
  });
  class MiniWidget extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<button type="button">Sync wishlist</button>';
      this.querySelector('button').addEventListener('click', () => {
        const notice = document.getElementById('cart-notice');
        notice.hidden = false;
        notice.textContent = 'Wishlist synced.';
      });
    }
  }
  customElements.define('mini-widget', MiniWidget);
`;

const CLEAN_SCRIPT = `
  const count = document.getElementById('cart-count');
  document.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      count.textContent = String(Number(count.textContent || '0') + 1);
      const notice = document.getElementById('cart-notice');
      notice.hidden = false;
      notice.textContent = 'Added to your cart.';
    });
  });
  document.querySelectorAll('.acc').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = document.getElementById(button.dataset.panel);
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
  });
  document.getElementById('icon-search').addEventListener('click', () => {
    const field = document.getElementById('search-field');
    field.hidden = !field.hidden;
    field.querySelector('input').focus();
  });
  document.getElementById('icon-account').addEventListener('click', () => {
    const menu = document.getElementById('account-menu');
    menu.hidden = !menu.hidden;
    document.getElementById('icon-account').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.getElementById('place-order').addEventListener('click', () => {
    document.getElementById('cart-notice').textContent = 'Order placed.';
  });
  document.getElementById('gift-card').addEventListener('click', () => {
    document.getElementById('cart-notice').textContent = 'Gift card applied.';
  });
  class MiniWidget extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<button type="button" aria-label="Sync your wishlist">Sync wishlist</button>';
      this.querySelector('button').addEventListener('click', () => {
        const notice = document.getElementById('cart-notice');
        notice.hidden = false;
        notice.textContent = 'Wishlist synced.';
      });
    }
  }
  customElements.define('mini-widget', MiniWidget);
`;

function paragraphBlock(): string {
  return `<div class="prose">${PROSE.slice(0, 4).map((text) => `<p>${text}</p>`).join("\n")}</div>`;
}

export const CHECKOUT_NOISY = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Aria Store — Checkout</title><style>${STYLE}</style></head>
<body>
<header class="topbar">
  <a class="brand" href="/">Aria Store</a>
  <nav aria-label="Main"><a href="/catalog">Catalog</a><a href="/deals">Deals</a><a href="/support">Support</a></nav>
  <button class="icon" id="icon-search" type="button"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg></button>
  <button class="icon" id="icon-account" type="button"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path></svg></button>
  <span>Cart: <span class="cart-count" id="cart-count">0</span></span>
</header>
<main>
  <h1>Your cart</h1>
  <p class="lede">Three things you picked. Free shipping over $150.</p>
  <p id="cart-notice" hidden></p>
  <section class="grid">${productCards("duplicate")}</section>
  <div class="ticker" aria-live="polite">Deal ends in <span id="clock">00:00:00.000</span> — <span id="promo">Free shipping over $150</span></div>
  <section class="faq" aria-label="Order questions">
    <button class="acc" type="button" aria-expanded="false" data-panel="p1">Payment methods</button>
    <div class="panel" id="p1" hidden>Cards, iDEAL, and bank transfer are accepted. Card details are never stored on our servers.</div>
    <button class="acc-broken" type="button" aria-expanded="false">Shipping details</button>
    <button class="acc" type="button" aria-expanded="false" data-panel="p2">Returns</button>
    <div class="panel" id="p2" hidden>Returns are open for thirty days. We pay return shipping on defective units.</div>
  </section>
  <button class="visually-hidden" type="button" tabindex="0">Restore saved cart</button>
  <button class="offscreen" type="button">Continue with a saved card</button>
  ${paragraphBlock()}
  <mini-widget></mini-widget>
  <iframe title="Coupon" src="/frame" width="320" height="90" style="border:1px solid var(--line);border-radius:10px;margin-top:18px"></iframe>
</main>
<div class="checkout-bar">
  <button type="button" id="gift-card">Apply gift card</button>
  <button type="button" class="primary" id="place-order">Place order</button>
</div>
<aside class="cookie" role="dialog" aria-label="Cookie settings">
  <p>We use cookies to measure traffic and personalise recommendations. Choose which ones you allow.</p>
  <button type="button" class="primary" id="accept-all">Accept all</button>
  <button type="button" id="essential-only">Essential only</button>
</aside>
<footer>Aria Store — demo fixture for agent-eye. No real orders, no network calls.</footer>
<script>
  ${NOISY_SCRIPT}
  document.getElementById('accept-all').addEventListener('click', () => document.querySelector('.cookie').remove());
  document.getElementById('essential-only').addEventListener('click', () => document.querySelector('.cookie').remove());
</script>
</body></html>`;

export const CHECKOUT_CLEAN = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Aria Store — Checkout (after)</title><style>${STYLE}</style></head>
<body>
<header class="topbar">
  <a class="brand" href="/">Aria Store</a>
  <nav aria-label="Main"><a href="/catalog">Catalog</a><a href="/deals">Deals</a><a href="/support">Support</a></nav>
  <button class="icon" id="icon-search" type="button" aria-label="Search products"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg></button>
  <button class="icon" id="icon-account" type="button" aria-label="Account menu" aria-expanded="false"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path></svg></button>
  <span>Cart: <span class="cart-count" id="cart-count">0</span></span>
</header>
<main>
  <h1>Your cart</h1>
  <p class="lede">Three things you picked. Free shipping over $150.</p>
  <p id="cart-notice" hidden></p>
  <div class="menu" id="account-menu" hidden><a href="/orders">Orders</a> · <a href="/settings">Settings</a></div>
  <div id="search-field" hidden><input type="search" aria-label="Search products" placeholder="Search products"></div>
  <section class="grid">${productCards("unique")}</section>
  <p class="ticker">Prices include VAT. Shipping is calculated at the next step.</p>
  <section class="faq" aria-label="Order questions">
    <button class="acc" type="button" aria-expanded="false" data-panel="p1">Payment methods</button>
    <div class="panel" id="p1" hidden>Cards, iDEAL, and bank transfer are accepted. Card details are never stored on our servers.</div>
    <button class="acc" type="button" aria-expanded="false" data-panel="p3">Shipping details</button>
    <div class="panel" id="p3" hidden>Ships in 2 business days from Rotterdam. Tracking arrives by email when the carrier scans the parcel.</div>
    <button class="acc" type="button" aria-expanded="false" data-panel="p2">Returns</button>
    <div class="panel" id="p2" hidden>Returns are open for thirty days. We pay return shipping on defective units.</div>
  </section>
  <mini-widget></mini-widget>
  ${paragraphBlock()}
</main>
<div class="checkout-bar">
  <button type="button" id="gift-card">Apply gift card</button>
  <button type="button" class="primary" id="place-order">Place order</button>
</div>
<footer>Aria Store — demo fixture for agent-eye. No real orders, no network calls.</footer>
<script>${CLEAN_SCRIPT}</script>
</body></html>`;

export const FRAME_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Coupon</title><style>
  body { margin:0; font:13px ui-sans-serif,system-ui,sans-serif; padding:10px; }
  input { width:120px; padding:6px; }
  button { padding:6px 10px; }
</style></head>
<body>
  <label for="coupon">Coupon</label>
  <input id="coupon" type="text" placeholder="SAVE10">
  <button type="button">Apply</button>
</body></html>`;

export const INDEX_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>agent-eye demo app</title><style>${STYLE}</style></head>
<body><main>
  <h1>agent-eye demo app</h1>
  <p class="lede">Two versions of the same checkout, served locally.</p>
  <ul>
    <li><a href="/checkout">/checkout</a> — before: overlay over the CTA, three identical labels, unnamed icon buttons, live ticker, one dead toggle, iframe and shadow-DOM controls.</li>
    <li><a href="/checkout-clean">/checkout-clean</a> — after: unique names, labelled icons, no overlay, no ticker, every control wired.</li>
  </ul>
</main></body></html>`;

export const DEMO_PAGES: Record<string, string> = {
  "/": INDEX_PAGE,
  "/checkout": CHECKOUT_NOISY,
  "/checkout-clean": CHECKOUT_CLEAN,
  "/frame": FRAME_PAGE,
};

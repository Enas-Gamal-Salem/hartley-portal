'use strict';
/* Hartley Leisure Member Portal — front-end demo with a mock backend in localStorage.
   Implements the rules in spec sections A1–A3. Demo only: do not store real data. */

const KEY = 'hartley-portal-v1';
const TZ = 'Europe/London';
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

const TIERS = {
  basic:     { name: 'Basic',     price: 25, weekly: 2,        guest: 0 },
  plus:      { name: 'Plus',      price: 40, weekly: 5,        guest: 1 },
  unlimited: { name: 'Unlimited', price: 60, weekly: Infinity, guest: 4 },
};
const TIER_ORDER = ['basic', 'plus', 'unlimited'];
const CENTRES = {
  manchester: 'Manchester Piccadilly',
  leeds: 'Leeds Central',
  london: 'London Canary Wharf',
  bristol: 'Bristol Harbourside',
};
const TYPES = ['Spin', 'Yoga', 'HIIT', 'Pilates', 'Boxing', 'Aqua'];
const INSTR = ['Sam Okafor', 'Priya Shah', 'Liam Doyle', 'Chloe Evans', 'Mo Hassan', 'Jess Turner'];
const SLOTS = [[7, 0, 45], [12, 30, 45], [18, 0, 60], [19, 0, 45]];
const CARDS = {
  '4242424242424242': 'ok',
  '5555555555554444': 'ok',
  '4000000000000002': 'Your card was declined.',
  '4000000000009995': 'Your card has insufficient funds.',
};

/* ---------------- storage ---------------- */
let db = load();
function seed() {
  const t = Date.now();
  return {
    members: [{
      id: 1, email: 'demo@hartley.test', password: 'Hartley123', name: 'Demo Member',
      dob: '1995-04-12', centre: 'manchester', tier: 'plus', status: 'active',
      createdAt: t - 20 * DAY, periodStart: t - 10 * DAY, pendingTier: null, cancelAtEnd: false,
      failedLogins: 0, lockedUntil: 0, blockedUntil: 0,
    }],
    bookings: [], waitlist: [], payments: [], emails: [], resetTokens: [],
    session: null, nextId: 2, offset: 0,
  };
}
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.members) return s; } catch (e) {} return seed(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
const nid = () => db.nextId++;
const now = () => Date.now() + (db.offset || 0);

/* ---------------- UK time helpers ---------------- */
const fmtParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function lp(date) {
  const o = {};
  fmtParts.formatToParts(date).forEach(p => { if (p.type !== 'literal') o[p.type] = +p.value; });
  return { y: o.year, m: o.month, d: o.day, h: o.hour, min: o.minute };
}
function londonToDate(y, m, d, h, min) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = lp(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return new Date(guess - (asUtc - guess));
}
const pad = n => String(n).padStart(2, '0');
const dsOf = date => { const p = lp(date); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
const timeOf = ts => { const p = lp(new Date(ts)); return `${pad(p.h)}:${pad(p.min)}`; };
const dayLabel = ds => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(ds + 'T00:00:00Z'));
const dtLabel = ts => `${dayLabel(dsOf(new Date(ts)))}, ${timeOf(ts)}`;
function weekKey(ts) { // Monday 00:00 – Sunday 23:59, UK time
  const p = lp(new Date(ts));
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}
function addMonth(ts) { const d = new Date(ts); d.setMonth(d.getMonth() + 1); return d.getTime(); }
const periodEnd = m => addMonth(m.periodStart);
const money = p => '£' + (p / 100).toFixed(2);

/* ---------------- classes (generated, deterministic) ---------------- */
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function genClass(centre, ds, si) {
  const [y, m, d] = ds.split('-').map(Number);
  const [hh, mm, dur] = SLOTS[si];
  const hs = hash(centre + ds + si);
  const cap = [10, 12, 20, 24][(hs >> 3) % 4];
  const r = (hs >> 6) % 10;
  const base = r < 2 ? cap : r < 5 ? Math.floor(cap * 0.7) : (hs >> 9) % Math.max(1, Math.floor(cap / 2));
  return {
    id: `${centre}|${ds}|${si}`, centre, type: TYPES[hs % TYPES.length], name: TYPES[hs % TYPES.length] + ' ' + ['Express', 'Flow', 'Burn', 'Core'][(hs >> 4) % 4],
    instructor: INSTR[(hs >> 2) % INSTR.length], start: londonToDate(y, m, d, hh, mm).getTime(), duration: dur, capacity: cap, base,
  };
}
function classById(id) {
  const [c, ds, si] = String(id).split('|');
  if (!CENTRES[c] || !/^\d{4}-\d\d-\d\d$/.test(ds || '') || !SLOTS[+si]) return null;
  return genClass(c, ds, +si);
}
function timetable(centre) {
  const p = lp(new Date(now())); const out = [];
  for (let i = 0; i <= 14; i++) {
    const ds = new Date(Date.UTC(p.y, p.m - 1, p.d + i)).toISOString().slice(0, 10);
    SLOTS.forEach((_, si) => { const c = genClass(centre, ds, si); if (c.start > now() && c.start <= now() + 14 * DAY) out.push(c); });
  }
  return out.sort((a, b) => a.start - b.start);
}
const active = b => b.status === 'booked' || b.status === 'attended';
const taken = c => Math.max(0, c.base - ((db.freed && db.freed[c.id]) || 0)) + db.bookings.filter(b => b.classId === c.id && active(b)).length;
const spaces = c => Math.max(0, c.capacity - taken(c));

/* ---------------- rules ---------------- */
function tick() { // apply lazy state changes
  db.members.forEach(m => { if (m.cancelAtEnd && m.status === 'active' && now() >= periodEnd(m)) m.status = 'cancelled'; });
  save();
}
const me = () => db.members.find(m => m.id === db.session?.memberId);
function weeklyUsed(m, ts) {
  const wk = weekKey(ts);
  return db.bookings.filter(b => b.memberId === m.id && ['booked', 'attended', 'late_cancelled', 'no_show'].includes(b.status) && weekKey(classById(b.classId).start) === wk).length;
}
function eligibility(m, c) {
  if (m.status === 'past_due') return 'Your last payment failed, so new bookings are paused. Update your payment to book.';
  if (m.status !== 'active') return 'You need an active membership to book classes.';
  if (m.blockedUntil > now()) return `Bookings are blocked until ${dtLabel(m.blockedUntil)} after 3 late cancellations.`;
  if (c.start <= now()) return 'This class has already started.';
  if (db.bookings.some(b => b.memberId === m.id && b.classId === c.id && b.status === 'booked')) return 'You are already booked on this class.';
  const lim = TIERS[m.tier].weekly;
  if (weeklyUsed(m, c.start) >= lim) return `You have used your ${lim} bookings for the week of ${dayLabel(weekKey(c.start))}.`;
  return null;
}
function email(m, subject, body, sendAt) { db.emails.push({ id: nid(), memberId: m.id, subject, body, sendAt: sendAt || now() }); }
function createBooking(m, c) {
  db.bookings.push({ id: nid(), memberId: m.id, classId: c.id, status: 'booked', createdAt: now(), cancelledAt: null });
  email(m, `Booking confirmed: ${c.name}`, `You're booked on ${c.name} with ${c.instructor} at ${CENTRES[c.centre]}, ${dtLabel(c.start)}.`);
  email(m, `Reminder: ${c.name} starts at ${timeOf(c.start)}`, `Your class ${c.name} starts in 2 hours (${timeOf(c.start)}).`, c.start - 2 * HOUR);
}
function book(classId) {
  const m = me(), c = classById(classId);
  if (!c) return { ok: false, msg: 'Class not found.' };
  const why = eligibility(m, c);
  if (why) return { ok: false, msg: why };
  if (spaces(c) <= 0) return { ok: false, msg: 'This class is full. Join the waiting list instead.' };
  createBooking(m, c); save();
  return { ok: true, msg: `Booked ${c.name} on ${dtLabel(c.start)}.` };
}
function joinWaitlist(classId) {
  const m = me(), c = classById(classId);
  if (!c) return { ok: false, msg: 'Class not found.' };
  const why = eligibility(m, c);
  if (why) return { ok: false, msg: why };
  if (spaces(c) > 0) return { ok: false, msg: 'There are spaces now — book directly.' };
  if (db.waitlist.some(w => w.classId === classId && w.memberId === m.id)) return { ok: false, msg: 'You are already on the waiting list.' };
  db.waitlist.push({ classId, memberId: m.id, at: now() }); save();
  return { ok: true, msg: 'You are on the waiting list. We will book you automatically and email you.' };
}
function promote(classId) {
  const c = classById(classId);
  const q = db.waitlist.filter(w => w.classId === classId).sort((a, b) => a.at - b.at);
  for (const w of q) {
    if (spaces(c) <= 0) break;
    db.waitlist = db.waitlist.filter(x => x !== w);
    const m = db.members.find(x => x.id === w.memberId);
    if (m && !eligibility(m, c)) { createBooking(m, c); email(m, `You're in! A space opened up: ${c.name}`, `You were first on the waiting list and have been booked on ${c.name}, ${dtLabel(c.start)}.`); }
  }
}
function cancelBooking(id) {
  const m = me(), b = db.bookings.find(x => x.id === id && x.memberId === m.id);
  if (!b || b.status !== 'booked') return { ok: false, msg: 'Booking not found.' };
  const c = classById(b.classId);
  if (c.start <= now()) return { ok: false, msg: 'This class has already started.' };
  const late = now() > c.start - 2 * HOUR; // exactly 2h before is still allowed
  b.status = late ? 'late_cancelled' : 'cancelled'; b.cancelledAt = now();
  let extra = '';
  if (late) {
    const recent = db.bookings.filter(x => x.memberId === m.id && x.status === 'late_cancelled' && x.cancelledAt > now() - 30 * DAY).length;
    if (recent >= 3) { m.blockedUntil = now() + 7 * DAY; extra = ' That is your 3rd late cancellation in 30 days — new bookings are blocked for 7 days.'; }
  }
  promote(b.classId); save();
  return { ok: true, msg: late ? 'Late cancellation: this booking still counts towards your weekly allowance.' + extra : 'Booking cancelled. Your allowance has been returned.' };
}

/* ---------------- membership ---------------- */
function charge(m, pence, status = 'succeeded') { db.payments.push({ id: nid(), memberId: m.id, amountPence: pence, status, createdAt: now() }); }
function changeTier(tier) {
  const m = me();
  if (!TIERS[tier]) return { ok: false, msg: 'Unknown tier.' };
  if (m.status !== 'active') return { ok: false, msg: 'Only active memberships can change tier.' };
  if (tier === m.tier && !m.pendingTier) return { ok: false, msg: 'You are already on this tier.' };
  const diff = TIERS[tier].price - TIERS[m.tier].price;
  if (tier === m.tier) { m.pendingTier = null; save(); return { ok: true, msg: 'Scheduled downgrade cancelled.' }; }
  if (diff > 0) {
    const frac = Math.max(0, (periodEnd(m) - now()) / (periodEnd(m) - m.periodStart));
    const pence = Math.round(diff * 100 * frac);
    charge(m, pence); m.tier = tier; m.pendingTier = null; save();
    return { ok: true, msg: `Upgraded to ${TIERS[tier].name}. Pro-rata charge: ${money(pence)}.` };
  }
  m.pendingTier = tier; save();
  return { ok: true, msg: `Downgrade to ${TIERS[tier].name} will take effect on ${dtLabel(periodEnd(m))}.` };
}
function billingCycle() {
  const m = me();
  if (m.cancelAtEnd) { m.status = 'cancelled'; return save(); }
  if (m.pendingTier) { m.tier = m.pendingTier; m.pendingTier = null; }
  m.periodStart = now(); charge(m, TIERS[m.tier].price * 100); save();
}

/* ---------------- validation ---------------- */
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const passOk = p => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
function ageOn(dob, ts) {
  const [by, bm, bd] = dob.split('-').map(Number), p = lp(new Date(ts));
  return p.y - by - ((p.m < bm || (p.m === bm && p.d < bd)) ? 1 : 0);
}

/* ---------------- UI ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 5200);
}
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.name)}</option>`).join('');
const route = () => (location.hash.replace(/^#\/?/, '') || '').split('?');

function shell(body, page) {
  const m = me();
  const nav = m ? ['dashboard', 'timetable', 'bookings', 'membership', 'inbox'].map(p => `<a href="#/${p}" class="${page === p ? 'on' : ''}">${p[0].toUpperCase() + p.slice(1)}</a>`).join('') : '';
  return `<header class="top"><div class="in"><a class="logo" href="#/">HARTLEY<span>.</span>LEISURE</a><nav>${nav}</nav>
    ${m ? `<div class="who">${esc(m.name)} <button class="sec" data-act="logout">Log out</button></div>` : ''}</div></header>
    <main>${body}</main>
    <button id="dev-btn" data-act="dev">QA tools</button><div id="dev" hidden>${devPanel()}</div>`;
}
function devPanel() {
  const m = me();
  return `<h3>QA tools</h3><p class="small muted">Simulated clock: <b>${dtLabel(now())}</b> (UK)</p>
  <label>Time travel (hours from real time)</label><input id="offset" type="number" step="0.5" value="${(db.offset || 0) / HOUR}">
  <button class="sec" data-act="setoffset">Apply</button>
  ${m ? `<button class="sec" data-act="pastdue">Fail monthly payment → past_due</button>
  <button class="sec" data-act="paid">Payment succeeds → active</button>
  <button class="sec" data-act="cycle">Run billing cycle now</button>` : ''}
  <button class="sec" data-act="freespace">A space opens in my waitlisted classes</button>
  <button class="danger" data-act="reset">Reset all demo data</button>`;
}

const pages = {
  login() {
    return `<div class="card narrow"><h1>Welcome back</h1><p class="muted">Log in to book classes and manage your membership.</p>
    <form data-form="login" novalidate><label>Email</label><input name="email" type="email" autocomplete="username">
    <label>Password</label><input name="password" type="password" autocomplete="current-password">
    <div class="err" id="err"></div><button class="full">Log in</button></form>
    <p class="small"><a href="#/forgot">Forgot password?</a> · <a href="#/signup">Join Hartley</a></p>
    <div class="banner info small">Demo account: <b>demo@hartley.test</b> / <b>Hartley123</b></div></div>`;
  },
  signup() {
    return `<div class="card narrow" style="max-width:560px"><h1>Join Hartley</h1>
    <form data-form="signup" novalidate>
    <label>Full name</label><input name="name" autocomplete="name">
    <label>Email</label><input name="email" type="email" autocomplete="email">
    <label>Password</label><input name="password" type="password" autocomplete="new-password"><div class="hint">At least 8 characters, with a letter and a number.</div>
    <label>Date of birth</label><input name="dob" type="date"><div class="hint">You must be 16 or older today.</div>
    <label>Home centre</label><select name="centre"><option value="">Choose…</option>${opts(CENTRES)}</select>
    <label>Membership</label><select name="tier">${TIER_ORDER.map(k => `<option value="${k}">${TIERS[k].name} — £${TIERS[k].price}/month</option>`).join('')}</select>
    <label>Card number (Stripe test mode)</label><input name="card" inputmode="numeric" placeholder="4242 4242 4242 4242">
    <div class="hint">Test cards: 4242 4242 4242 4242 succeeds · 4000 0000 0000 0002 declined · 4000 0000 0000 9995 insufficient funds.</div>
    <div class="err" id="err"></div><button class="full">Create account &amp; pay</button></form>
    <p class="small">Already a member? <a href="#/login">Log in</a></p></div>`;
  },
  forgot() {
    return `<div class="card narrow"><h1>Reset your password</h1><form data-form="forgot" novalidate>
    <label>Email</label><input name="email" type="email"><div class="err" id="err"></div><button class="full">Send reset link</button></form>
    <p class="small"><a href="#/login">Back to login</a></p></div>`;
  },
  reset(q) {
    const token = new URLSearchParams(q || '').get('token');
    const t = db.resetTokens.find(x => x.token === token);
    if (!t || t.used || t.expires < now()) return `<div class="card narrow"><h1>Link not valid</h1><p class="muted">This reset link has expired or has already been used.</p><a class="btn" href="#/forgot">Request a new link</a></div>`;
    return `<div class="card narrow"><h1>Choose a new password</h1><form data-form="reset" data-token="${esc(token)}" novalidate>
    <label>New password</label><input name="password" type="password" autocomplete="new-password"><div class="hint">At least 8 characters, with a letter and a number.</div>
    <div class="err" id="err"></div><button class="full">Update password</button></form></div>`;
  },
  dashboard() {
    const m = me(), t = TIERS[m.tier], used = weeklyUsed(m, now()), lim = t.weekly;
    const up = db.bookings.filter(b => b.memberId === m.id && b.status === 'booked' && classById(b.classId).start > now()).sort((a, b) => classById(a.classId).start - classById(b.classId).start).slice(0, 4);
    return `<h1>Hi ${esc(m.name.split(' ')[0])} 👋</h1>${statusBanner(m)}
    <div class="grid g3">
      <div class="card"><div class="muted small">Membership</div><div class="stat">${t.name}</div><span class="pill ${m.status}">${m.status}</span>${m.pendingTier ? `<div class="small muted">Moving to ${TIERS[m.pendingTier].name} on ${dayLabel(dsOf(new Date(periodEnd(m))))}</div>` : ''}</div>
      <div class="card"><div class="muted small">Bookings this week (Mon–Sun, UK)</div><div class="stat">${used}${lim === Infinity ? '' : ' / ' + lim}</div>
        ${lim === Infinity ? '<div class="small muted">Unlimited</div>' : `<div class="bar"><i style="width:${Math.min(100, used / lim * 100)}%"></i></div>`}</div>
      <div class="card"><div class="muted small">Guest passes / month</div><div class="stat">${t.guest}</div><div class="small muted">Home centre: ${esc(CENTRES[m.centre])}</div></div>
    </div>
    <div class="card"><h2>Upcoming classes</h2>${up.length ? up.map(b => { const c = classById(b.classId); return `<div class="cls"><div class="time">${timeOf(c.start)}</div><div><b>${esc(c.name)}</b><div class="meta">${dayLabel(dsOf(new Date(c.start)))} · ${esc(c.instructor)}</div></div><div class="act"><a href="#/bookings">Manage</a></div></div>`; }).join('') : '<p class="muted">Nothing booked yet.</p><a class="btn" href="#/timetable">Browse timetable</a>'}</div>`;
  },
  timetable(q) {
    const m = me(), type = new URLSearchParams(q || '').get('type') || '';
    const list = timetable(m.centre).filter(c => !type || c.type === type);
    let html = `<h1>Timetable</h1><p class="muted">${esc(CENTRES[m.centre])} · next 14 days · times are UK local time</p>${statusBanner(m)}
    <div class="filters"><select data-filter="type"><option value="">All classes</option>${TYPES.map(t => `<option ${t === type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    let last = '';
    list.forEach(c => {
      const ds = dsOf(new Date(c.start));
      if (ds !== last) { html += `${last ? '</div>' : ''}<div class="day">${dayLabel(ds)}</div><div class="card">`; last = ds; }
      const left = spaces(c), booked = db.bookings.some(b => b.memberId === m.id && b.classId === c.id && b.status === 'booked');
      const wl = db.waitlist.some(w => w.classId === c.id && w.memberId === m.id);
      const blocked = m.status !== 'active';
      const btn = booked ? '<span class="pill booked">Booked</span>' : wl ? '<span class="pill waitlist">On waiting list</span>'
        : left > 0 ? `<button data-act="book" data-id="${c.id}" ${blocked ? 'disabled' : ''}>Book</button>` : `<button class="amber" data-act="wait" data-id="${c.id}" ${blocked ? 'disabled' : ''}>Join waiting list</button>`;
      html += `<div class="cls"><div class="time">${timeOf(c.start)}</div><div><b>${esc(c.name)}</b><div class="meta">${esc(c.instructor)} · ${c.duration} min · capacity ${c.capacity}</div></div>
        <div class="act"><div class="spaces ${left === 0 ? 'none' : left <= 3 ? 'low' : ''}">${left === 0 ? 'Full' : left + ' space' + (left === 1 ? '' : 's') + ' left'}</div>${btn}</div></div>`;
    });
    return html + (last ? '</div>' : '<p class="muted">No classes found.</p>');
  },
  bookings(q) {
    const m = me(), tab = new URLSearchParams(q || '').get('status') || 'upcoming';
    const mine = db.bookings.filter(b => b.memberId === m.id).map(b => ({ b, c: classById(b.classId) }));
    const rows = mine.filter(x => tab === 'upcoming' ? x.c.start > now() && x.b.status === 'booked' : !(x.c.start > now() && x.b.status === 'booked')).sort((a, z) => tab === 'upcoming' ? a.c.start - z.c.start : z.c.start - a.c.start);
    const wl = db.waitlist.filter(w => w.memberId === m.id);
    return `<h1>My bookings</h1>${statusBanner(m)}
    <div class="filters"><a class="btn ${tab === 'upcoming' ? '' : 'sec'}" style="${tab === 'upcoming' ? '' : 'background:#e7efec;color:#14231f'}" href="#/bookings?status=upcoming">Upcoming</a>
    <a class="btn" style="${tab === 'past' ? '' : 'background:#e7efec;color:#14231f'}" href="#/bookings?status=past">Past &amp; cancelled</a></div>
    <div class="card">${rows.length ? rows.map(({ b, c }) => {
      const canCancel = b.status === 'booked' && c.start > now(), late = now() > c.start - 2 * HOUR;
      return `<div class="cls"><div class="time">${timeOf(c.start)}</div><div><b>${esc(c.name)}</b><div class="meta">${dayLabel(dsOf(new Date(c.start)))} · ${esc(c.instructor)} · ${esc(CENTRES[c.centre])}</div></div>
      <div class="act"><span class="pill ${b.status}">${b.status.replace('_', ' ')}</span>${canCancel ? `<div><button class="danger" style="margin-top:.4rem" data-act="cancel" data-id="${b.id}" data-late="${late}">Cancel</button></div>` : ''}</div></div>`;
    }).join('') : '<p class="muted">Nothing here.</p>'}</div>
    ${tab === 'upcoming' && wl.length ? `<div class="card"><h2>Waiting lists</h2>${wl.map(w => { const c = classById(w.classId); return `<div class="cls"><div class="time">${timeOf(c.start)}</div><div><b>${esc(c.name)}</b><div class="meta">${dayLabel(dsOf(new Date(c.start)))}</div></div><div class="act"><button class="sec" data-act="leavewait" data-id="${w.classId}">Leave</button></div></div>`; }).join('')}</div>` : ''}
    <p class="small muted">Free cancellation up to 2 hours before the class. Later cancellations or no-shows count as late; 3 in 30 days blocks bookings for 7 days.</p>`;
  },
  membership() {
    const m = me(), mine = db.payments.filter(p => p.memberId === m.id).sort((a, b) => b.createdAt - a.createdAt);
    return `<h1>Membership</h1>${statusBanner(m)}
    <p class="muted">Current period ends ${dtLabel(periodEnd(m))}${m.cancelAtEnd ? ' — <b>cancelling, active until then</b>' : ''}.</p>
    <div class="grid g3">${TIER_ORDER.map(k => { const t = TIERS[k], cur = m.tier === k;
      const dir = TIER_ORDER.indexOf(k) - TIER_ORDER.indexOf(m.tier);
      return `<div class="card tier ${cur ? 'cur' : ''}"><h2>${t.name}</h2><div class="price">£${t.price}<span class="small muted">/month</span></div>
      <ul><li>${t.weekly === Infinity ? 'Unlimited' : t.weekly} bookings per week</li><li>${t.guest} guest pass${t.guest === 1 ? '' : 'es'} per month</li></ul>
      ${cur ? (m.pendingTier ? `<button class="sec" data-act="tier" data-tier="${k}">Keep ${t.name}</button>` : '<span class="pill active">Current plan</span>')
        : `<button data-act="tier" data-tier="${k}" ${m.status !== 'active' ? 'disabled' : ''}>${dir > 0 ? 'Upgrade (pro-rata now)' : 'Downgrade (next billing date)'}</button>`}
      ${m.pendingTier === k ? '<div class="small muted">Scheduled</div>' : ''}</div>`; }).join('')}</div>
    <div class="card"><h2>Cancel membership</h2><p class="muted small">Your membership stays active until the end of the paid period.</p>
    ${m.cancelAtEnd ? '<button class="sec" data-act="resume">Keep my membership</button>' : `<button class="danger" data-act="cancelmem" ${m.status === 'cancelled' ? 'disabled' : ''}>Cancel at end of period</button>`}</div>
    <div class="card"><h2>Payments</h2>${mine.length ? `<table><tr><th>Date</th><th>Amount</th><th>Status</th></tr>${mine.map(p => `<tr><td>${dtLabel(p.createdAt)}</td><td>${money(p.amountPence)}</td><td>${p.status}</td></tr>`).join('')}</table>` : '<p class="muted">No payments yet.</p>'}</div>`;
  },
  inbox() {
    const m = me(), mine = db.emails.filter(e => e.memberId === m.id).sort((a, b) => b.sendAt - a.sendAt);
    return `<h1>Inbox <span class="small muted">(simulated emails)</span></h1>
    ${mine.length ? mine.map(e => `<div class="email ${e.sendAt > now() ? 'sched' : ''}"><b>${esc(e.subject)}</b><div class="small muted">${e.sendAt > now() ? 'Scheduled for ' : 'Sent '}${dtLabel(e.sendAt)}</div><div>${esc(e.body)}</div></div>`).join('') : '<p class="muted">No emails yet.</p>'}`;
  },
};
function statusBanner(m) {
  if (m.status === 'past_due') return `<div class="banner warn"><b>Payment failed.</b> Your account is past due. You can view your bookings but can't make new ones until payment succeeds.</div>`;
  if (m.status === 'cancelled') return `<div class="banner bad"><b>Membership ended.</b> You need an active membership to book classes.</div>`;
  if (m.blockedUntil > now()) return `<div class="banner bad"><b>Bookings blocked</b> until ${dtLabel(m.blockedUntil)} (3 late cancellations in 30 days).</div>`;
  if (m.cancelAtEnd) return `<div class="banner info">Your membership will end on ${dtLabel(periodEnd(m))}.</div>`;
  return '';
}

function render() {
  tick();
  let [p, q] = route();
  const m = me();
  if (db.session && db.session.expires < now()) { db.session = null; save(); }
  const authed = ['dashboard', 'timetable', 'bookings', 'membership', 'inbox'];
  const open = ['login', 'signup', 'forgot', 'reset'];
  if (!p) p = me() ? 'dashboard' : 'login';
  if (authed.includes(p) && !me()) p = 'login';
  if (open.includes(p) && me() && p !== 'reset') p = 'dashboard';
  if (!pages[p]) p = me() ? 'dashboard' : 'login';
  $('#app').innerHTML = shell(pages[p](q), p);
  document.title = 'Hartley Leisure – ' + p[0].toUpperCase() + p.slice(1);
}
const go = h => { if (location.hash === h) render(); else location.hash = h; };

/* ---------------- events ---------------- */
function formData(f) { return Object.fromEntries(new FormData(f).entries()); }
function setErr(msg) { const e = $('#err'); if (e) e.textContent = msg; }

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const d = formData(f), kind = f.dataset.form;
  if (kind === 'login') {
    const em = (d.email || '').trim().toLowerCase(), m = db.members.find(x => x.email === em);
    if (!em || !d.password) return setErr('Enter your email and password.');
    if (m && m.lockedUntil > now()) return setErr(`Account locked. Try again in ${Math.ceil((m.lockedUntil - now()) / MIN)} minute(s).`);
    if (!m || m.password !== d.password) {
      if (m) { m.failedLogins++; if (m.failedLogins >= 5) { m.lockedUntil = now() + 15 * MIN; m.failedLogins = 0; save(); return setErr('Too many failed attempts. Your account is locked for 15 minutes.'); } save(); }
      return setErr('Invalid email or password.');
    }
    m.failedLogins = 0; m.lockedUntil = 0; db.session = { memberId: m.id, expires: now() + 24 * HOUR }; save(); go('#/dashboard'); render();
  }
  if (kind === 'signup') {
    const em = (d.email || '').trim().toLowerCase();
    if (!d.name.trim()) return setErr('Enter your full name.');
    if (!emailOk(em)) return setErr('Enter a valid email address.');
    if (db.members.some(x => x.email === em)) return setErr('An account with this email already exists.');
    if (!passOk(d.password)) return setErr('Password needs at least 8 characters, including a letter and a number.');
    if (!d.dob) return setErr('Enter your date of birth.');
    const age = ageOn(d.dob, now());
    if (age < 0) return setErr('Date of birth cannot be in the future.');
    if (age < 16) return setErr('You must be 16 or older to join.');
    if (!CENTRES[d.centre]) return setErr('Choose your home centre.');
    const card = (d.card || '').replace(/\s/g, ''), res = CARDS[card];
    if (!res) return setErr('Enter a valid Stripe test card number.');
    if (res !== 'ok') return setErr(res);
    const m = { id: nid(), email: em, password: d.password, name: d.name.trim(), dob: d.dob, centre: d.centre, tier: d.tier, status: 'active', createdAt: now(), periodStart: now(), pendingTier: null, cancelAtEnd: false, failedLogins: 0, lockedUntil: 0, blockedUntil: 0 };
    db.members.push(m); charge(m, TIERS[m.tier].price * 100);
    db.session = { memberId: m.id, expires: now() + 24 * HOUR }; save(); go('#/dashboard'); render(); toast('Welcome to Hartley!', 'ok');
  }
  if (kind === 'forgot') {
    const em = (d.email || '').trim().toLowerCase();
    if (!emailOk(em)) return setErr('Enter a valid email address.');
    const m = db.members.find(x => x.email === em);
    if (m) { const token = Math.random().toString(36).slice(2) + Date.now().toString(36); db.resetTokens.push({ token, memberId: m.id, expires: now() + 60 * MIN, used: false }); email(m, 'Reset your password', `Reset link (valid 60 minutes, single use): ${location.origin}${location.pathname}#/reset?token=${token}`); }
    save(); toast('If that email is registered, a reset link has been sent. (Demo: log in to the account and check Inbox, or use the link shown below.)', 'ok');
    if (m) { const t = db.resetTokens[db.resetTokens.length - 1]; f.insertAdjacentHTML('afterend', `<div class="banner info small">Demo shortcut: <a href="#/reset?token=${t.token}">open reset link</a></div>`); }
  }
  if (kind === 'reset') {
    const t = db.resetTokens.find(x => x.token === f.dataset.token);
    if (!t || t.used || t.expires < now()) return render();
    if (!passOk(d.password)) return setErr('Password needs at least 8 characters, including a letter and a number.');
    db.members.find(x => x.id === t.memberId).password = d.password; t.used = true; save(); go('#/login'); toast('Password updated. Please log in.', 'ok');
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset.filter === 'type') go('#/timetable' + (e.target.value ? '?type=' + e.target.value : ''));
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  const res = r => { toast(r.msg, r.ok ? 'ok' : 'bad'); render(); };
  if (a === 'dev') { const d = $('#dev'); d.hidden = !d.hidden; return; }
  if (a === 'logout') { db.session = null; save(); go('#/login'); return render(); }
  if (a === 'book') return res(book(id));
  if (a === 'wait') return res(joinWaitlist(id));
  if (a === 'leavewait') { db.waitlist = db.waitlist.filter(w => !(w.classId === id && w.memberId === me().id)); save(); return res({ ok: true, msg: 'Removed from waiting list.' }); }
  if (a === 'cancel') {
    if (el.dataset.late === 'true' && !confirm('This is less than 2 hours before the class. It will count as a LATE cancellation and will not return your allowance. Continue?')) return;
    return res(cancelBooking(+id));
  }
  if (a === 'tier') return res(changeTier(el.dataset.tier));
  if (a === 'cancelmem') { if (confirm('Cancel at the end of your paid period?')) { me().cancelAtEnd = true; save(); res({ ok: true, msg: 'Membership will end at the end of the paid period.' }); } return; }
  if (a === 'resume') { me().cancelAtEnd = false; save(); return res({ ok: true, msg: 'Your membership will continue.' }); }
  // QA tools
  if (a === 'setoffset') { db.offset = (parseFloat($('#offset').value) || 0) * HOUR; save(); render(); $('#dev').hidden = false; return; }
  if (a === 'pastdue') { const m = me(); m.status = 'past_due'; charge(m, TIERS[m.tier].price * 100, 'failed'); save(); return res({ ok: true, msg: 'Monthly payment failed → past_due.' }); }
  if (a === 'paid') { const m = me(); m.status = 'active'; charge(m, TIERS[m.tier].price * 100); save(); return res({ ok: true, msg: 'Payment succeeded → active.' }); }
  if (a === 'cycle') { billingCycle(); return res({ ok: true, msg: 'Billing cycle applied (pending downgrade / cancellation processed).' }); }
  if (a === 'freespace') {
    const ids = [...new Set(db.waitlist.filter(w => w.memberId === me().id).map(w => w.classId))]; let n = 0;
    db.freed = db.freed || {};
    ids.forEach(cid => { db.freed[cid] = (db.freed[cid] || 0) + 1; promote(cid); n++; });
    save(); return res({ ok: true, msg: n ? 'Space opened — first person on each waiting list was booked automatically (see Inbox).' : 'You are not on any waiting list.' });
  }
  if (a === 'reset') { if (confirm('Reset all demo data?')) { db = seed(); save(); go('#/login'); render(); } return; }
});

window.addEventListener('hashchange', render);
render();

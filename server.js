'use strict';
require('dotenv').config();
const express    = require('express');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3002;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
);

async function log(entry) {
  try {
    await supabase.from('email_events').insert(entry);
  } catch (e) { /* swallow */ }
}

// ── Open pixel ────────────────────────────────────────────────────────────────
app.get('/t/open/:id', (req, res) => {
  log({ lead_id: req.params.id, event: 'open', ip: req.ip });
  res.set({
    'Content-Type':  'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma':        'no-cache',
  });
  res.send(PIXEL);
});

// ── Click redirect ────────────────────────────────────────────────────────────
app.get('/t/click/:id', (req, res) => {
  const dest = req.query.url || 'https://leadengine.admexo.com';
  const isCalendly = dest.includes('calendly.com') || dest.includes('tidycal.com');
  log({ lead_id: req.params.id, event: isCalendly ? 'calendly' : 'click', dest });
  res.redirect(302, dest);
});

// ── Unsubscribe ───────────────────────────────────────────────────────────────
app.get('/unsubscribe/:id', async (req, res) => {
  const id = req.params.id;
  await log({ lead_id: id, event: 'unsubscribe', ip: req.ip });
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#1e293b">
  <h2 style="color:#16a34a">&#10003; You've been unsubscribed</h2>
  <p style="color:#64748b;margin-top:12px">You won't receive any more emails from ADMEXO.<br>If this was a mistake, reply to the original email.</p>
</body></html>`);
});

// ── Stats page ────────────────────────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  const { data: events = [] } = await supabase
    .from('email_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000);

  // Extract batch tag and business name from lead_id
  // Formats: "b4-business-name-v1" or "business-name-v1" (older)
  function parseLeadId(id) {
    const m = id && id.match(/^(b\d+)?-?(.+)-v(\d+)$/);
    if (m) return { batch: m[1] || 'older', name: m[2].replace(/-/g, ' '), version: 'v' + m[3] };
    return { batch: 'older', name: id || '?', version: '?' };
  }

  // Aggregate per lead
  const leads = {};
  for (const e of events) {
    if (!leads[e.lead_id]) leads[e.lead_id] = { opens: 0, clicks: 0, calendly: 0, lastOpen: null, lastClick: null };
    if (e.event === 'open')     { leads[e.lead_id].opens++;    leads[e.lead_id].lastOpen  = e.created_at; }
    if (e.event === 'click')    { leads[e.lead_id].clicks++;   leads[e.lead_id].lastClick = e.created_at; }
    if (e.event === 'calendly') { leads[e.lead_id].calendly++; leads[e.lead_id].lastClick = e.created_at; }
  }

  // Aggregate per batch
  const batches = {};
  for (const e of events) {
    const info = parseLeadId(e.lead_id);
    const bk = info.batch;
    if (!batches[bk]) batches[bk] = { sent: new Set(), opens: 0, clicks: 0, calendly: 0, opens_unique: new Set() };
    batches[bk].sent.add(e.lead_id);
    if (e.event === 'open')     { batches[bk].opens++;  batches[bk].opens_unique.add(e.lead_id); }
    if (e.event === 'click')    batches[bk].clicks++;
    if (e.event === 'calendly') batches[bk].calendly++;
  }

  const BATCH_LABELS = { b1: 'Batch 1', b2: 'Batch 2', b3: 'Batch 3', b4: 'Batch 4 (Houston+Dallas+Austin)', older: 'Pre-batch' };

  const batchRows = Object.entries(batches)
    .sort((a,b) => (a[0] === 'older' ? 1 : b[0] === 'older' ? -1 : a[0].localeCompare(b[0])))
    .map(([bk, d]) => {
      const sent = d.sent.size;
      const openRate = sent ? Math.round(d.opens_unique.size / sent * 100) : 0;
      const label = BATCH_LABELS[bk] || bk;
      return `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${label}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${sent}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.opens>0?'#16a34a':'#94a3b8'};font-weight:700">${d.opens}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.clicks>0?'#6366f1':'#94a3b8'};font-weight:700">${d.clicks}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.calendly>0?'#f59e0b':'#94a3b8'};font-weight:700">${d.calendly}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;min-width:100px">
          <div style="background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:#16a34a;height:8px;width:${openRate}%;border-radius:4px"></div>
          </div>
          <span style="font-size:11px;color:#64748b">${openRate}% open</span>
        </td>
      </tr>`;
    }).join('');

  const rows = Object.entries(leads)
    .sort((a, b) => (b[1].opens + b[1].clicks) - (a[1].opens + a[1].clicks))
    .map(([id, d]) => {
      const info = parseLeadId(id);
      const displayName = info.name.replace(/\b\w/g, c => c.toUpperCase());
      return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${displayName}<br><span style="font-size:11px;color:#94a3b8;font-weight:400">${info.batch} · ${info.version}</span></td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.opens>0?'#16a34a':'#94a3b8'};font-weight:700">${d.opens}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.clicks>0?'#6366f1':'#94a3b8'};font-weight:700">${d.clicks}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.calendly>0?'#f59e0b':'#94a3b8'};font-weight:700">${d.calendly||0}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b"><span class="ts" data-ts="${d.lastOpen || ''}">${d.lastOpen || '—'}</span></td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b"><span class="ts" data-ts="${d.lastClick || ''}">${d.lastClick || '—'}</span></td>
      </tr>`;
    }).join('');

  const totalOpens       = events.filter(e => e.event === 'open').length;
  const totalClicks      = events.filter(e => e.event === 'click').length;
  const totalCalendly    = events.filter(e => e.event === 'calendly').length;
  const totalUnsub       = events.filter(e => e.event === 'unsubscribe').length;
  const uniqueOpens      = new Set(events.filter(e=>e.event==='open').map(e=>e.lead_id)).size;

  // Version labels
  const VERSION_LABELS = {
    v1: 'V1 — Silent Leak',
    v2: 'V2 — Competitor',
    v3: 'V3 — Cost',
    v4: 'V4 — Timeline',
    v5: 'V5 — Personal Find',
  };

  // Aggregate by version (lead_id ends in -v1 … -v5)
  const versions = {};
  for (const e of events) {
    const m = e.lead_id && e.lead_id.match(/-v(\d+)$/);
    const vk = m ? `v${m[1]}` : 'other';
    if (!versions[vk]) versions[vk] = { sent: new Set(), opens: 0, clicks: 0 };
    versions[vk].sent.add(e.lead_id);
    if (e.event === 'open')  versions[vk].opens++;
    if (e.event === 'click') versions[vk].clicks++;
  }

  const versionRows = Object.entries(versions)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([vk, d]) => {
      const sent     = d.sent.size;
      const openRate = sent ? Math.round(d.opens / sent * 100) : 0;
      const clickRate= sent ? Math.round(d.clicks / sent * 100) : 0;
      const label    = VERSION_LABELS[vk] || vk;
      const barW     = openRate;
      return `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${label}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${sent}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.opens>0?'#16a34a':'#94a3b8'};font-weight:700">${d.opens}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.clicks>0?'#6366f1':'#94a3b8'};font-weight:700">${d.clicks}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;min-width:120px">
          <div style="background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:#16a34a;height:8px;width:${barW}%;border-radius:4px"></div>
          </div>
          <span style="font-size:11px;color:#64748b">${openRate}% open · ${clickRate}% click</span>
        </td>
      </tr>`;
    }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Email Tracker — ADMEXO</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b}</style>
</head>
<body>
<div style="background:#0f0f1a;padding:16px 32px;display:flex;align-items:center;gap:12px">
  <span style="font-size:17px;font-weight:800;color:#fff">ADMEXO</span>
  <span style="font-size:11px;color:#6366f1;text-transform:uppercase;letter-spacing:1.2px;font-weight:600">Email Tracker</span>
</div>

<div style="max-width:960px;margin:32px auto;padding:0 16px">

  <!-- Summary cards -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:32px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Total Opens</div>
      <div style="font-size:32px;font-weight:900;color:#16a34a">${totalOpens}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Unique Openers</div>
      <div style="font-size:32px;font-weight:900;color:#0ea5e9">${uniqueOpens}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Report Clicks</div>
      <div style="font-size:32px;font-weight:900;color:#6366f1">${totalClicks}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Calendly Clicks</div>
      <div style="font-size:32px;font-weight:900;color:#f59e0b">${totalCalendly}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Unsubscribed</div>
      <div style="font-size:32px;font-weight:900;color:#ef4444">${totalUnsub}</div>
    </div>
  </div>

  <!-- Batch summary table -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:28px">
    <div style="padding:18px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px">
      <h2 style="font-size:16px;font-weight:700">Performance by Batch</h2>
      <span style="font-size:12px;color:#94a3b8">— sent / opens / clicks / bookings</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Batch</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Sent</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Opens</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Clicks</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Bookings</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Open Rate</th>
        </tr>
      </thead>
      <tbody>${batchRows || '<tr><td colspan="6" style="padding:24px;text-align:center;color:#94a3b8">No data yet</td></tr>'}</tbody>
    </table>
  </div>

  <!-- Version A/B table -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:28px">
    <div style="padding:18px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px">
      <h2 style="font-size:16px;font-weight:700">Performance by Version</h2>
      <span style="font-size:12px;color:#94a3b8">— which subject line wins</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Version</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Sent</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Opens</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Clicks</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Rate</th>
        </tr>
      </thead>
      <tbody>${versionRows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8">No data yet</td></tr>'}</tbody>
    </table>
  </div>

  <!-- Per-lead table -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="padding:18px 20px;border-bottom:1px solid #f1f5f9">
      <h2 style="font-size:16px;font-weight:700">Per-Lead Activity</h2>
      <span style="font-size:12px;color:#94a3b8">— individual opens, clicks and bookings</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Lead</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Opens</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Clicks</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Calendly</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Last Open</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Last Click</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="padding:24px;text-align:center;color:#94a3b8">No events yet</td></tr>'}</tbody>
    </table>
  </div>

  <p style="margin-top:16px;font-size:12px;color:#94a3b8;text-align:right">
    Auto-refresh every 60s &nbsp;·&nbsp; <a href="/stats" style="color:#6366f1">Refresh now</a>
  </p>
</div>
<script>
  document.querySelectorAll('.ts').forEach(el => {
    const ts = el.dataset.ts;
    if (ts) el.textContent = new Date(ts).toLocaleString();
  });
  setTimeout(()=>location.reload(), 60000);
</script>
</body>
</html>`);
});

app.get('/', (req, res) => res.redirect('/stats'));

app.listen(PORT, () => console.log(`Tracker running on port ${PORT}`));

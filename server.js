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
  log({ lead_id: req.params.id, event: 'click', dest });
  res.redirect(302, dest);
});

// ── Stats page ────────────────────────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  const { data: events = [] } = await supabase
    .from('email_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000);

  // Aggregate per lead
  const leads = {};
  for (const e of events) {
    if (!leads[e.lead_id]) leads[e.lead_id] = { opens: 0, clicks: 0, lastOpen: null, lastClick: null };
    if (e.event === 'open')  { leads[e.lead_id].opens++;  leads[e.lead_id].lastOpen  = e.created_at; }
    if (e.event === 'click') { leads[e.lead_id].clicks++; leads[e.lead_id].lastClick = e.created_at; }
  }

  const rows = Object.entries(leads)
    .sort((a, b) => (b[1].opens + b[1].clicks) - (a[1].opens + a[1].clicks))
    .map(([id, d]) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-weight:600">${id}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.opens>0?'#16a34a':'#94a3b8'};font-weight:700">${d.opens}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;color:${d.clicks>0?'#6366f1':'#94a3b8'};font-weight:700">${d.clicks}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${d.lastOpen ? new Date(d.lastOpen).toLocaleString() : '—'}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${d.lastClick ? new Date(d.lastClick).toLocaleString() : '—'}</td>
      </tr>`).join('');

  const totalOpens  = events.filter(e => e.event === 'open').length;
  const totalClicks = events.filter(e => e.event === 'click').length;
  const uniqueOpens = new Set(events.filter(e=>e.event==='open').map(e=>e.lead_id)).size;

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

<div style="max-width:900px;margin:32px auto;padding:0 16px">

  <!-- Summary cards -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Total Opens</div>
      <div style="font-size:36px;font-weight:900;color:#16a34a">${totalOpens}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Unique Openers</div>
      <div style="font-size:36px;font-weight:900;color:#0ea5e9">${uniqueOpens}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;font-weight:600;margin-bottom:8px">Report Clicks</div>
      <div style="font-size:36px;font-weight:900;color:#6366f1">${totalClicks}</div>
    </div>
  </div>

  <!-- Table -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="padding:18px 20px;border-bottom:1px solid #f1f5f9">
      <h2 style="font-size:16px;font-weight:700">Per-Lead Activity</h2>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Lead</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Opens</th>
          <th style="padding:10px 14px;text-align:center;font-size:12px;font-weight:600;color:#64748b">Clicks</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Last Open</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#64748b">Last Click</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8">No events yet</td></tr>'}</tbody>
    </table>
  </div>

  <p style="margin-top:16px;font-size:12px;color:#94a3b8;text-align:right">
    Auto-refresh every 60s &nbsp;·&nbsp; <a href="/stats" style="color:#6366f1">Refresh now</a>
  </p>
</div>
<script>setTimeout(()=>location.reload(), 60000)</script>
</body>
</html>`);
});

app.get('/', (req, res) => res.redirect('/stats'));

app.listen(PORT, () => console.log(`Tracker running on port ${PORT}`));

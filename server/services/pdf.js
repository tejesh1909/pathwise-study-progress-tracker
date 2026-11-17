/* Progress report as a PDF (pdfkit). */
const PDFDocument = require('pdfkit');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');

function buildPdf({ learner, goals, topics, sessions, config, today }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Progress report — ${learner.name}`, Author: 'Pathwise' } });
  const ink = '#1b1b2f', muted = '#6b6b80', accent = '#6d5dfc';
  doc.fillColor(accent).fontSize(10).text('PATHWISE', { characterSpacing: 2 });
  doc.fillColor(ink).fontSize(22).text('Progress report', { lineGap: 2 });
  doc.fillColor(muted).fontSize(10).text(`${learner.name} · generated ${today}`).moveDown(1);

  const totalMin = sessions.reduce((a, s) => a + s.minutes, 0);
  const done = topics.filter((t) => t.complete).length;
  doc.fillColor(ink).fontSize(11).text(`${goals.length} goals · ${done}/${topics.length} topics complete · ${Features.fmtMin(totalMin)} studied across ${sessions.length} sessions`).moveDown(1);

  for (const g of goals) {
    const gt = topics.filter((t) => t.goalId === g.id);
    const gs = sessions.filter((s) => s.goalId === g.id);
    const p = Rules.goalProgress(gt, gs);
    const f = Features.goalForecast({ goal: g, topics: gt, sessions: gs, config, today });
    if (doc.y > 680) doc.addPage();
    doc.fillColor(ink).fontSize(14).text(g.title);
    doc.fillColor(muted).fontSize(10).text(`${p.percent}% complete · ${Features.fmtMin(p.totalMinutes)} logged${g.targetDate ? ` · target ${g.targetDate}` : ''}`);
    doc.fillColor(f.status === 'on_track' || f.status === 'done' ? '#1f9d6b' : '#c2410c').text(f.headline).moveDown(0.4);
    const y = doc.y;
    doc.rect(48, y, 499, 6).fill('#e6e6f0');
    doc.rect(48, y, Math.max(2, 499 * (p.percent / 100)), 6).fill(accent);
    doc.y = y + 14;
    const st = Rules.computeStates(gt, Rules.minutesByTopic(gs));
    const label = { complete: 'Complete', locked: 'Locked', pending: 'Awaiting approval', in_progress: 'In progress', available: 'Ready' };
    for (const t of gt) {
      if (doc.y > 770) doc.addPage();
      const miss = st[t.id].missing.map((id) => (gt.find((x) => x.id === id) || {}).title).filter(Boolean);
      doc.fillColor(ink).fontSize(10).text(`${t.title}`, 56, doc.y, { continued: true }).fillColor(muted).text(`  —  ${label[st[t.id].state]}${miss.length ? ` (needs ${miss.join(', ')})` : ''}${t.estimateMinutes ? ` · est ${Features.fmtMin(t.estimateMinutes)}` : ''}`);
    }
    doc.x = 48; doc.moveDown(1);
  }
  doc.end();
  return doc;
}

module.exports = { buildPdf };

'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const Q = 'Quality_Risk_Score', O = 'Operational_Resilience_Score', F = 'Financial_Health_Score';
const label = k => ({[Q]:'Quality risk',[O]:'Operational risk',[F]:'Financial risk',Total_Risk_Index:'Source total risk index'}[k] || k.replace(/_Score$/, '').replaceAll('_', ' '));
const level = n => n == null ? 'Unknown' : n < 25 ? 'Low' : n < 50 ? 'Medium' : n < 75 ? 'High' : 'Critical';
const color = n => ({Low:'#22a06b',Medium:'#e2a81d',High:'#f07a2e',Critical:'#e5484d',Unknown:'#aaa'}[level(n)]);
const badge = (n, l=level(n)) => `<span class="badge ${esc(level(n).toLowerCase())}">${esc(l)} <b>${n == null ? '—' : esc(n)}</b></span>`;
const eur = new Intl.NumberFormat('en', {style:'currency', currency:'EUR', maximumFractionDigits:0});
const OPS = [['po_volume_eur','Purchase order volume','eur'],['delivery_rating','Supplier delivery rating','pct'],['confirmation_rate','Order confirmation rate','pct'],['order_change_rate','Order change rate','pct'],['sourcing_risk_level','Sourcing risk level (source)','text'],['supply_chain_complexity','Supply chain complexity (source)','text']];
const fact = (r, key, kind) => { const v = r.operations?.[key]; return v == null ? '—' : kind === 'eur' ? eur.format(v) : kind === 'pct' ? v.toFixed(1) + '%' : esc(v); };
const DEFAULT = {component:'', profile:'quality_first', max_risk:100, query:'', exclude:[], candidate_ids:[], limit:20};
let selection = {...DEFAULT};
let result = null, service = null, compared = new Set(), lastResearch = null, pollTimer = null, currentJob = null, rankSeq = 0, toastTimer, chatBusy = false, lastModel = null, transcript = [];

async function api(path, body, method='POST') {
  const res = await fetch('/api'+path, {method: body === undefined ? 'GET' : method, headers: body === undefined ? {} : {'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  let data; try { data = await res.json(); } catch { throw new Error(`Request failed (${res.status}). Check the server.`); }
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail) && data.detail[0]?.msg ? `${data.detail[0].loc?.at(-1) ?? 'Input'}: ${data.detail[0].msg}.` : `Request failed (${res.status}). Check the supplied data.`);
  return data;
}
function toast(text, ms=6500) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, ms); }
function md(text) {
  const lines = esc(text).split('\n'); let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (let line of lines) {
    line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${m[1]}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${m[1]}</li>`; }
    else if ((m = line.match(/^\s*#{1,6}\s+(.*)/))) { close(); html += `<h4>${m[1]}</h4>`; }
    else if (!line.trim()) close();
    else { close(); html += `<p>${line}</p>`; }
  }
  close(); return html;
}
function chipState(el, p, name) {
  const state = !p.configured ? 'off' : p.ok === true ? 'ok' : p.ok === false ? 'fail' : 'untested';
  el.className = 'chip ' + state;
  el.textContent = {off:`○ ${name} not configured`, ok:`● ${name} connected`, fail:`✕ ${name} failed`, untested:`◐ ${name} key set · untested`}[state];
  el.title = (p.detail || '') + (state === 'off' ? '' : ' · Click to test');
}
function renderStatus() {
  const n = service.providers.nemotron, t = service.providers.tavily;
  $('#dataset-count').textContent = service.rows.toLocaleString();
  $('#data-status').textContent = (service.sample ? 'Sample · ' : 'Dataset · ') + service.rows.toLocaleString() + ' suppliers';
  $('#data-status').title = service.name;
  chipState($('#model-status'), n, 'Nemotron'); chipState($('#search-status'), t, 'Tavily');
  $('#agent-dot').style.background = n.ok ? '#22a06b' : n.configured ? '#e2a81d' : '#bbb';
  $('#agent-label').textContent = !n.configured ? 'Add a Token Factory key to enable chat' : n.ok ? `${service.model} · live` : n.ok === false ? 'Nemotron connection failed · see Test connections' : `${service.model} · key set, not yet tested`;
  $('#research-dot').className = 'tiny-dot ' + (n.ok && t.ok ? 'green' : '');
  $('#notice').hidden = !service.sample;
  $('#notice').textContent = 'Sample dataset: 3 supplied supplier records with partial risk columns. Import the organizer CSV to screen the complete pool. Manufacturing capability, price and lead time are not established by these scores.';
}
async function testConnections() {
  const buttons = [$('#test-connections'), $('#model-status'), $('#search-status')];
  buttons.forEach(b => b.disabled = true); toast('Sending a small live request to each provider…', 20000);
  try { service = await api('/connection-test', {}); renderStatus(); const n = service.providers.nemotron, t = service.providers.tavily; toast(`Nemotron: ${n.detail}  ·  Tavily: ${t.detail}`, 9000); }
  catch (e) { toast(e.message); } finally { buttons.forEach(b => b.disabled = false); }
}
function gather() {
  selection.component = $('#component').value.trim() || DEFAULT.component;
  selection.max_risk = Number($('#risk-limit').value);
  selection.query = $('#supplier-search').value.trim();
  selection.candidate_ids = [...new Set($('#candidate-ids').value.split(/[\s,;]+/).filter(Boolean))];
}
async function rank() {
  gather(); const seq = ++rankSeq;
  $('#rank').disabled = true; $('.shortlist').classList.add('loading');
  try { const data = await api('/shortlist', selection); if (seq !== rankSeq) return; result = data; render(); }
  catch (e) { if (seq === rankSeq) toast(e.message); }
  finally { if (seq === rankSeq) { $('#rank').disabled = false; $('.shortlist').classList.remove('loading'); } }
}
function render() {
  if (!result) return;
  selection = {...result.request};
  $('#thread-title').dataset.component = selection.component;
  $('#component').value = selection.component;
  $('#risk-limit').value = selection.max_risk; $('#risk-value').value = selection.max_risk;
  document.querySelectorAll('[data-profile]').forEach(b => { const on = b.dataset.profile === selection.profile; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
  $('#funnel').innerHTML = `<div class="funnel-item"><strong>${result.total.toLocaleString()}</strong><span>source suppliers</span></div><span class="funnel-arrow">→</span><div class="funnel-item"><strong>${result.scoped.toLocaleString()}</strong><span>in candidate pool</span></div><span class="funnel-arrow">→</span><div class="funnel-item"><strong>${result.matched.toLocaleString()}</strong><span>pass screening</span></div><span class="funnel-arrow">→</span><div class="funnel-item"><strong>${result.suppliers.length}</strong><span>in your shortlist</span></div>`;
  $('#shortlist-size').textContent = String(result.suppliers.length).padStart(2, '0');
  $('#capability').textContent = result.capability + (result.unrankable ? ` ${result.unrankable} rows excluded because required scores are missing.` : '') + (result.missing_candidate_ids.length ? ` ${result.missing_candidate_ids.length} candidate IDs were not found: ${result.missing_candidate_ids.slice(0, 5).join(', ')}${result.missing_candidate_ids.length > 5 ? '…' : ''}.` : '');
  $('#supplier-rows').innerHTML = result.suppliers.length ? result.suppliers.map((r, i) => `<tr><td><div class="supplier"><span class="rank-num">${i+1}</span><span class="supplier-avatar" style="background:${['#e8eefc','#eaf5ef','#f6ede4','#eeeaf8'][i%4]};color:${['#2457d6','#0f7a4a','#9a5414','#5a3fb0'][i%4]}">${esc(r.name.split(' ').slice(0, 2).map(x => x[0]).join(''))}</span><button class="supplier-link" data-inspect="${esc(r.id)}">${esc(r.name)}<small>${esc(r.id)}</small></button></div></td><td><span class="score">${r.buyer_score.toFixed(1)}</span></td><td>${badge(r.tri, r.level)}</td><td><div class="mini-bars" role="img" aria-label="${esc([Q,O,F].map(k => label(k)+': '+(r.scores[k] ?? 'unknown')).join(', '))}">${[Q,O,F].map(k => `<span title="${esc(label(k))}: ${r.scores[k] ?? 'unknown'}" style="height:${Math.max(3, (r.scores[k] || 0) * .3)}px;background:${color(r.scores[k])}"></span>`).join('')}</div></td><td><span class="fact-cell" title="Supplier delivery rating · order confirmation rate">${fact(r, 'delivery_rating', 'pct')}<small>${fact(r, 'confirmation_rate', 'pct')} conf.</small></span></td><td><div class="row-actions"><button class="compare-toggle ${compared.has(r.id) ? 'selected' : ''}" data-compare="${esc(r.id)}" aria-pressed="${compared.has(r.id)}">${compared.has(r.id) ? '✓ Added' : '+ Compare'}</button><button class="icon-btn" data-exclude="${esc(r.id)}" title="Mark unavailable and recalculate" aria-label="Mark ${esc(r.id)} unavailable">⊘</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="no-results">No suppliers pass this screen. Relax the risk threshold, widen the candidate scope or restore excluded candidates.</td></tr>';
  $('#formula').textContent = 'Buyer score = ' + Object.entries(result.weights).map(([k, w]) => `${Number((w*100).toFixed(1))}% ${label(k).replace(' risk', '')}`).join(' + ') + '. Lower is better. Source TRI is unchanged; its original weighting is not published.';
  $('#excluded').innerHTML = result.excluded.length ? `<span class="excluded-label">Unavailable:</span>` + result.excluded.map(x => `<span class="excluded-chip">${esc(x.id)} · ${esc(x.name)}<button data-restore="${esc(x.id)}" aria-label="Restore ${esc(x.id)}">×</button></span>`).join('') : '';
  $('#restore').hidden = result.excluded.length < 2;
  const winner = result.suppliers[0], second = result.suppliers[1];
  $('#recommendation').innerHTML = winner ? `<div class="section-label">↗ LEADING RISK CANDIDATE</div><h3>${esc(winner.name)}</h3><div class="id">${esc(winner.id)}</div><div class="winner-score">${winner.buyer_score.toFixed(1)}<span>buyer risk / 100</span></div><p>Ranks first under <b>${esc(selection.profile.replaceAll('_', ' '))}</b>${second ? `, ${(second.buyer_score-winner.buyer_score).toFixed(1)} points ahead of ${esc(second.name)}` : ' as the only candidate in this screen'}. Quality ${winner.scores[Q]}, operations ${winner.scores[O]}, financial risk ${winner.scores[F]}; source TRI ${winner.tri}.</p><button id="exclude-winner">What if this supplier is unavailable? ↗</button><div class="verification">Risk candidate only. Verify component approval, capacity, price and delivery before awarding a contract.</div>` : '<div class="section-label">NO RECOMMENDATION</div><h3>No candidate passes.</h3><p>Adjust the screen. Gauge will not recommend a supplier outside your constraints.</p>';
  $('#compare-count').textContent = compared.size + ' / 20';
}
function syncCompare() { $('#compare-count').textContent = compared.size + ' / 20'; $('#context-count').textContent = compared.size + (compared.size === 1 ? ' supplier' : ' suppliers') + ' in context'; document.querySelectorAll('[data-alt-compare]').forEach(b => { const on = compared.has(b.dataset.altCompare); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Added' : '+ Compare'; b.closest('.alt-row')?.classList.toggle('on', on); }); render(); }
function exclude(id) { selection.exclude = [...new Set([...selection.exclude, id])]; rank(); toast(id + ' marked unavailable. Ranking recalculated across the whole pool.'); }
function factsHtml(r) { return `<div class="facts">${OPS.map(([k, name, kind]) => `<div><span>${name}</span><b>${fact(r, k, kind)}</b></div>`).join('')}</div>`; }
async function inspect(id) {
  try {
    const data = await api('/compare', {ids:[id]}); const r = data.suppliers[0]; $('#detail-title').textContent = r.name;
    const inList = result?.suppliers.find(x => x.id === id);
    $('#detail-content').innerHTML = `<p class="muted">${esc(r.id)} · ${esc(service.name)}${inList ? ` · rank ${inList.rank}, buyer score ${inList.buyer_score.toFixed(1)} under ${esc(selection.profile.replaceAll('_', ' '))}` : ''}</p><div class="metric"><b>Source Total Risk Index</b><div></div><span>${badge(r.tri, r.level)}</span></div>` + Object.entries(r.scores).sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1)).map(([k, v]) => `<div class="metric"><span>${esc(label(k))}${[Q,O,F].includes(k) ? ' <em>· in buyer score</em>' : ''}</span><div class="metric-track"><span style="width:${v ?? 0}%;background:${color(v)}"></span></div><span class="score">${v ?? '—'}</span></div>`).join('') + `<div class="section-label" style="margin-top:18px">OPERATIONAL FACTS FROM THE SOURCE FILE</div>${factsHtml(r)}<p class="muted">All score fields measure risk: 0 = lowest, 100 = highest. A score indicates a screening signal; the CSV does not explain its underlying cause. Original Total Risk Index weights are not provided.</p><div class="dialog-actions"><button class="black" data-explain="${esc(r.id)}">Explain this supplier's risks with Nemotron ↗</button><button class="outline" data-compare-add="${esc(r.id)}">${compared.has(r.id) ? 'Remove from comparison' : 'Add to comparison'}</button></div>`;
    $('#detail-dialog').showModal();
  } catch (e) { toast(e.message); }
}
async function showCompare() {
  if (!compared.size) { toast('Add suppliers using the Compare buttons in the shortlist.'); return; }
  try {
    const data = await api('/compare', {ids:[...compared]}); const rows = data.suppliers; const keys = [...new Set(rows.flatMap(r => Object.keys(r.scores)))];
    const buyer = id => { const x = result?.suppliers.find(s => s.id === id); return x ? `<span class="score">${x.buyer_score.toFixed(1)}</span><small class="muted"> rank ${x.rank}</small>` : '<span class="muted">not in current shortlist</span>'; };
    $('#compare-content').innerHTML = `<table class="compare-table"><thead><tr><th>RISK CRITERION</th>${rows.map(r => `<th>${esc(r.name)}<small>${esc(r.id)}</small><button class="text-btn" data-remove-compare="${esc(r.id)}">Remove</button></th>`).join('')}</tr></thead><tbody><tr class="emph"><td>Buyer score · ${esc(selection.profile.replaceAll('_', ' '))} (app-defined)</td>${rows.map(r => `<td>${buyer(r.id)}</td>`).join('')}</tr><tr><td>Source total risk index</td>${rows.map(r => `<td>${badge(r.tri, r.level)}</td>`).join('')}</tr>${keys.map(k => `<tr><td>${esc(label(k))}${[Q,O,F].includes(k) ? ' <em>· in buyer score</em>' : ''}</td>${rows.map(r => `<td>${badge(r.scores[k])}</td>`).join('')}</tr>`).join('')}${OPS.map(([k, name, kind]) => `<tr class="facts-row"><td>${name}</td>${rows.map(r => `<td>${fact(r, k, kind)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (!$('#compare-dialog').open) $('#compare-dialog').showModal();
  } catch (e) { toast(e.message); }
}
function message(text, cls, html=false) { const el = document.createElement('div'); el.className = 'message ' + cls; if (html) el.innerHTML = text; else el.textContent = text; $('#messages').append(el); $('#messages').scrollTop = $('#messages').scrollHeight; return el; }
async function sendChat(text) {
  if (chatBusy || !text.trim()) return;
  if (!service.providers.nemotron.configured) { toast('Add NEBIUS_API_KEY to the server configuration to enable Nemotron. Ranking and comparison already work.'); return; }
  gather(); chatBusy = true; $('#send').disabled = true; message(text, 'user'); transcript.push({role:'buyer', text});
  const pending = message('<i class="spinner"></i> Nemotron is working with the supplier tools…', 'assistant pending', true);
  try {
    const data = await api('/chat', {message:text, selection});
    pending.classList.remove('pending'); pending.innerHTML = md(data.reply); lastModel = data.model; transcript.push({role:'nemotron', text:data.reply});
    result = data.selection; render();
    if (data.comparison) { data.comparison.suppliers.forEach(s => { if (compared.size < 20) compared.add(s.id); }); syncCompare(); }
    $('#tool-trace').innerHTML = data.trace.length ? data.trace.map(t => `<div class="trace-line">${t.status === 'done' ? '✓' : '!'} ${esc(t.tool.replaceAll('_', ' '))}${t.detail ? ` <small>${esc(t.detail)}</small>` : ''}</div>`).join('') + (data.comparison ? '<button class="text-btn" id="trace-compare">Open the inspected records side by side ↗</button>' : '') : '<div class="trace-line muted">Answered without tools</div>';
    if (data.job_id) { $('#research-dialog').showModal(); startPolling(data.job_id); }
  } catch (e) { pending.classList.remove('pending'); pending.textContent = e.message; pending.classList.add('error'); }
  finally { chatBusy = false; $('#send').disabled = false; $('#messages').scrollTop = $('#messages').scrollHeight; }
}
async function researchOpen() { $('#research-dialog').showModal(); loadReports(); }
async function loadReports() {
  try {
    const data = await api('/research'); const jobs = data.jobs;
    $('#reports-list').innerHTML = jobs.length ? `<div class="section-label">PREVIOUS RESEARCH</div>` + jobs.map(j => `<button data-open-job="${esc(j.id)}"><span class="tiny-dot ${j.status === 'done' ? 'green' : j.status === 'error' ? 'red' : 'running'}"></span>${esc(j.company)}<small>${j.status === 'done' ? `${j.sources} sources · ${j.elapsed} s` : esc(j.status)}</small></button>`).join('') : '';
  } catch (e) { $('#reports-list').innerHTML = ''; }
}
function safeUrl(url) { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } }
function renderResearch(data) {
  lastResearch = data;
  const steps = (data.steps || []).map(s => `<div class="research-step ${esc(s.state)}"><span>${s.state === 'running' ? '<i class="spinner"></i>' : s.state === 'error' ? '!' : '✓'}</span><span>${esc(s.text)}</span><small>${s.at} s</small></div>`).join('');
  const report = data.report ? `<div class="report">${md(data.report).replace(/\[(\d+)\]/g, (_, n) => data.sources.some(s => s.id === Number(n)) ? `<a href="#source-${n}">[${n}]</a>` : `[${n}]`)}</div>` : '';
  const sources = (data.sources || []).map(s => `<a id="source-${s.id}" class="source" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">[${s.id}] ${esc(s.title)}<small>${esc(new URL(safeUrl(s.url), location.href).hostname)}${s.published ? ' · ' + esc(s.published) : ''}</small></a>`).join('');
  $('#research-content').innerHTML = `<div class="section-label">${esc(data.company)} · ${esc(data.status)}${data.elapsed ? ' · ' + data.elapsed + ' s' : ''}</div><div class="research-steps">${steps || '<div class="research-step"><i class="spinner"></i> Queued for research</div>'}</div>${data.follow_up_reason ? `<p class="muted">Agent's follow-up decision: ${esc(data.follow_up_reason)}</p>` : ''}${data.error ? `<div class="notice">${esc(data.error)}</div>` : ''}${data.citation_warning ? '<div class="notice">Citation check incomplete: the brief cites no sources or an unknown source ID. Inspect the linked excerpts before relying on it.</div>' : ''}${report}${sources ? `<div class="section-label">SOURCES RETRIEVED BY TAVILY</div><div class="sources">${sources}</div>` : ''}<p class="muted">Web evidence is separate from the anonymized CSV. Scores and shortlist rankings are unchanged.</p>`;
  $('#research-dot').className = 'tiny-dot ' + (data.status === 'done' ? 'green' : data.status === 'error' ? 'red' : 'running');
}
function startPolling(id) {
  clearTimeout(pollTimer); currentJob = id;
  const poll = async () => { if (currentJob !== id) return; try { const data = await api('/research/'+id); if (currentJob !== id) return; renderResearch(data); if (!['done', 'error'].includes(data.status)) pollTimer = setTimeout(poll, 1500); else { $('#research-submit').disabled = false; loadReports(); } } catch (e) { toast(e.message); $('#research-submit').disabled = false; } };
  poll();
}
function downloadMemo() {
  if (!result) return; const winner = result.suppliers[0]; const top = result.suppliers.slice(0, 3);
  const text = `# Gauge — sourcing brief

Component: ${selection.component || 'not specified'}
Dataset: ${service.name} (${service.rows.toLocaleString()} suppliers${service.sample ? ', SAMPLE DATA' : ''}), data version ${result.version}
Generated: ${new Date().toISOString()}

## Selection
${result.capability}
Priority profile: ${selection.profile}. Maximum source Total Risk Index: ${selection.max_risk}.${selection.candidate_ids.length ? `\nCandidate scope: ${selection.candidate_ids.join(', ')}.` : ''}
Marked unavailable: ${result.excluded.length ? result.excluded.map(x => `${x.id} (${x.name})`).join(', ') : 'none'}.
Funnel: ${result.total} source suppliers → ${result.scoped} in candidate pool → ${result.matched} pass screening → ${result.suppliers.length} shortlisted.

## Recommendation
${winner ? `${winner.id} — ${winner.name}. Buyer score ${winner.buyer_score}; source TRI ${winner.tri} (${winner.level}).` : 'No candidate passes the current constraints.'}

## Scoring method
${$('#formula').textContent}
All _Score fields are supplied risk scores (0 lowest risk, 100 highest), including Financial_Health_Score and Operational_Resilience_Score. Buyer score = Σ weight × score over quality, operational and financial risk. Missing values stay unknown and such rows are not ranked. Source Total_Risk_Index is shown unchanged.

## Shortlist
${result.suppliers.map(r => `${r.rank}. ${r.id} — ${r.name}: buyer ${r.buyer_score}; TRI ${r.tri}; quality ${r.scores[Q]}, operations ${r.scores[O]}, financial risk ${r.scores[F]}; delivery rating ${fact(r, 'delivery_rating', 'pct')}, confirmation ${fact(r, 'confirmation_rate', 'pct')}`).join('\n') || 'empty'}

## Evidence for the leading candidates
${top.map(r => `### ${r.id} — ${r.name}\n${Object.entries(r.scores).map(([k, v]) => `- ${label(k)}: ${v ?? 'unknown'} (${r.source_levels[k+'_Level'] || level(v)})`).join('\n')}\n${OPS.map(([k, name, kind]) => `- ${name}: ${fact(r, k, kind).replace(/&amp;/g, '&')}`).join('\n')}`).join('\n\n') || 'none'}
${compared.size ? `\nCompared side by side: ${[...compared].join(', ')}.` : ''}
${transcript.length ? `\n## Nemotron explanations (${lastModel || 'model'})\n${transcript.map(t => `**${t.role}:** ${t.text}`).join('\n\n')}` : ''}
${lastResearch?.report ? `\n## Separate real-company web research: ${lastResearch.company}\nStatus ${lastResearch.status}; ${lastResearch.sources.length} sources; agent follow-up decision: ${lastResearch.follow_up_reason || 'n/a'}.\n\n${lastResearch.report}\n\nSources\n${lastResearch.sources.map(s => `[${s.id}] ${s.title}: ${s.url}`).join('\n')}\n\nThis research is not linked to any anonymized dataset ID.` : ''}

## Outstanding checks before award
- Component capability and regulatory approvals${selection.component ? ` for "${selection.component}"` : ''}: not established by the risk dataset.
- Capacity, price, lead time and real legal identity of the shortlisted suppliers.
- Cause behind any High or Critical score; the dataset gives signals, not explanations.
- Original Total_Risk_Index weighting (not published).${lastResearch?.citation_warning ? '\n- Web research citations were incomplete; review the sources.' : ''}
`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:'text/markdown'})); a.download = 'gauge-sourcing-brief.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.close) $('#'+b.dataset.close).close();
  if (b.dataset.profile) { selection.profile = b.dataset.profile; rank(); }
  if (b.dataset.inspect) inspect(b.dataset.inspect);
  if (b.dataset.compare || b.dataset.compareAdd) { const id = b.dataset.compare || b.dataset.compareAdd; if (compared.has(id)) compared.delete(id); else if (compared.size < 20) compared.add(id); else toast('Compare supports up to 20 suppliers.'); syncCompare(); if (b.dataset.compareAdd) $('#detail-dialog').close(); }
  if (b.dataset.removeCompare) { compared.delete(b.dataset.removeCompare); syncCompare(); if (compared.size) showCompare(); else $('#compare-dialog').close(); }
  if (b.dataset.prompt) sendChat(b.dataset.prompt);
  if (b.dataset.exclude) exclude(b.dataset.exclude);
  if (b.dataset.restore) { selection.exclude = selection.exclude.filter(x => x !== b.dataset.restore); rank(); }
  if (b.dataset.explain) { const id = b.dataset.explain; const name = result?.suppliers.find(x => x.id === id)?.name || ''; $('#detail-dialog').close(); sendChat(`Explain the main risk signals for ${id}${name ? ' (' + name + ')' : ''} using its source scores and operational facts. Which scores drive its buyer score, which hidden scores stand out, and what should the buyer verify?`); }
  if (b.dataset.company) $('#company-name').value = b.dataset.company;
  if (b.dataset.openJob) startPolling(b.dataset.openJob);
  if (b.id === 'exclude-winner' && result?.suppliers[0]) exclude(result.suppliers[0].id);
  if (b.id === 'trace-compare') showCompare();
  if (b.id === 'explain-compare') { const ids = [...compared]; $('#compare-dialog').close(); sendChat(`Compare ${ids.join(', ')} ${selection.component ? `for ${selection.component}` : 'for this purchase'}. Inspect their records, explain where they trade off (quality, operations, financial and hidden risks) and which one the buyer should prefer under the current priority.`); }
  if (b.id === 'clear-compare') { compared.clear(); syncCompare(); $('#compare-dialog').close(); }
});
$('#rank').onclick = rank; $('#risk-limit').oninput = () => $('#risk-value').value = $('#risk-limit').value; $('#risk-limit').onchange = rank;
let searchTimer; $('#supplier-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(rank, 250); };
$('#restore').onclick = () => { selection.exclude = []; rank(); }; $('#open-compare').onclick = showCompare;
$('#open-research').onclick = researchOpen;
$('#test-connections').onclick = testConnections; $('#model-status').onclick = testConnections; $('#search-status').onclick = testConnections;
$('#explorer').onclick = () => { $('#explorer-panel').open = true; $('#explorer-panel').scrollIntoView({behavior:'smooth'}); };
$('#reset').onclick = () => { selection = {...DEFAULT}; $('#component').value = DEFAULT.component; $('#risk-limit').value = 100; $('#candidate-ids').value = ''; $('#supplier-search').value = ''; compared.clear(); transcript = []; $('#messages').replaceChildren(); message('A new decision. Set your purchase brief and choose a risk priority.', 'assistant'); $('#tool-trace').textContent = ''; rank(); };
$('#chat-form').onsubmit = e => { e.preventDefault(); const text = $('#chat-input').value; if (!chatBusy) { $('#chat-input').value = ''; sendChat(text); } };
$('#chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); } };
$('#research-form').onsubmit = async e => { e.preventDefault(); const company = $('#company-name').value.trim(); if (!company) return; $('#research-submit').disabled = true;
  try { const data = await api('/research', {company, context:selection.component || 'Supplier procurement'}); $('#research-content').innerHTML = '<div class="research-step running"><i class="spinner"></i> Planning research…</div>'; startPolling(data.job_id); } catch (err) { toast(err.message, 9000); $('#research-submit').disabled = false; } };
$('#upload-button').onclick = () => $('#csv-file').click(); $('#csv-file').onchange = async () => { const file = $('#csv-file').files[0]; if (!file) return; const data = new FormData(); data.append('file', file); $('#upload-button').disabled = true; toast('Importing and validating the CSV…', 20000);
  try { const res = await fetch('/api/upload', {method:'POST', body:data}); const payload = await res.json(); if (!res.ok) throw new Error(payload.detail || 'Upload failed'); service = payload; compared.clear(); selection.exclude = []; selection.candidate_ids = []; $('#candidate-ids').value = ''; $('#supplier-search').value = ''; selection.query = ''; renderStatus(); await rank(); toast(`Dataset imported: ${payload.rows.toLocaleString()} suppliers validated. Imported data stays in memory until restart.`); } catch (e) { toast(e.message, 9000); } finally { $('#upload-button').disabled = false; $('#csv-file').value = ''; } };
$('#download-memo').onclick = downloadMemo;
async function init() { try { service = await api('/status'); renderStatus(); await rank(); } catch (e) { $('#notice').hidden = false; $('#notice').textContent = e.message; } }
// ---- Research thread: chat-style composer, live plan, verdict, sources and alternatives ----
const thread = $('#thread'), heroHtml = $('#hero').outerHTML;
const GROUP_NAMES = ['Financial', 'Operational', 'Compliance', 'Geo', 'Reputation'];
const AV_BG = ['#e8eefc', '#eaf5ef', '#f6ede4', '#eeeaf8', '#f2f2f4'], AV_FG = ['#2457d6', '#0f7a4a', '#9a5414', '#5a3fb0', '#55555c'];
const MARK = '<svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M3 12.5a6 6 0 0 1 12 0" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M9 12.5l3.2-3.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>';
const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.3l2.8 2.8L12.5 5" stroke="#111113" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const compactEur = new Intl.NumberFormat('en', {style:'currency', currency:'EUR', notation:'compact', maximumFractionDigits:1});
let mode = 'research', dataBusy = false;
const polls = new Map();

function addBubble(text) { $('#hero')?.remove(); const el = document.createElement('div'); el.className = 'bubble-row'; el.innerHTML = `<div class="bubble">${esc(text)}</div>`; thread.append(el); return el; }
function addTurn() { const el = document.createElement('section'); el.className = 'turn'; el.setAttribute('aria-label', 'Gauge answer'); thread.append(el); el.scrollIntoView({behavior:'smooth', block:'start'}); return el; }
function turnHead(thinking, text) { return `<div class="turn-head"><div class="av" aria-hidden="true">${MARK}${thinking ? '<span class="ring"></span>' : ''}</div><b>Gauge</b>${thinking ? `<span class="turn-status">${esc(text)}<span class="dots"><i></i><i></i><i></i></span></span>` : `<span class="turn-meta">${esc(text)}</span>`}</div>`; }
function cite(html, job) { return html.replace(/\[(\d+)\]/g, (_, n) => (job.sources || []).some(s => s.id === Number(n)) ? `<a href="#src-${esc(job.id)}-${n}">[${n}]</a>` : `[${n}]`); }
function host(url) { try { return new URL(safeUrl(url), location.href).hostname.replace(/^www\./, ''); } catch { return ''; } }

function planStep(s, job) {
  const done = s.state === 'done', meta = s.meta || `${s.at} s`;
  let t = s.text, d = s.detail || '', m = meta;
  let x;
  if ((x = s.text.match(/^(Tavily search|Follow-up search): (.*?)(?: · (\d+) new source\(s\))?$/))) { t = x[1] === 'Tavily search' ? 'Web search' : 'Digging deeper'; d = '“' + x[2] + '”'; m = x[3] != null ? `${x[3]} new source${x[3] === '1' ? '' : 's'}` : meta; }
  else if (s.flag) { t = 'Red flag: follow-up needed'; d = s.text.replace(/^Red flag:\s*/, ''); m = 'flagged'; }
  else if (/checking evidence gaps/.test(s.text)) { t = done ? 'Reviewed the evidence for red flags' : 'Checking the evidence for red flags'; }
  else if (/planning company and risk searches/.test(s.text)) t = 'Planning web searches';
  else if (/writing the evidence-backed/.test(s.text)) { t = done ? 'Wrote the cited report' : 'Writing the cited report'; }
  else if (/^No follow-up needed/.test(s.text)) { t = 'No red flag requiring a follow-up search'; d = job.follow_up_reason || ''; }
  const icon = s.state === 'running' ? '<span class="spin" aria-hidden="true"></span>' : s.state === 'error' ? '<span class="step-err">!</span>' : s.flag ? '<span class="flag-dot"></span>' : CHECK;
  return `<li class="plan-step rise ${s.flag ? 'flag' : ''} ${s.branch ? 'branch' : ''} ${esc(s.state)}"><span class="plan-icon">${icon}</span><span class="plan-body"><span class="plan-title"><span>${esc(t)}</span><small>${esc(m)}</small></span>${d ? `<span class="plan-detail">${esc(d)}</span>` : ''}</span></li>`;
}
function statusText(job) {
  const s = (job.steps || []).at(-1);
  if (!s || job.status === 'queued') return 'Planning';
  if (s.kind === 'understand') return 'Understanding the request';
  if (s.text.startsWith('Tavily search')) return 'Searching the web';
  if (s.text.startsWith('Follow-up')) return 'Red flag — digging deeper';
  if (/checking evidence/.test(s.text)) return 'Checking for red flags';
  if (/writing/.test(s.text)) return 'Writing the report';
  return 'Planning';
}
function altTable(job) {
  const alt = job.alternatives; if (!alt) return '';
  const rows = alt.suppliers.map((r, i) => {
    const on = compared.has(r.id), initials = r.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const bars = GROUP_NAMES.map(g => { const v = r.groups[g]; return `<span title="${esc(g)} ${v ?? 'unknown'}" style="height:${Math.max(3, Math.round((v || 0) * .28))}px;background:${color(v)}"></span>`; }).join('');
    return `<div class="alt-row ${on ? 'on' : ''}" role="row"><span class="mono faint">${r.rank}</span><span class="alt-sup"><span class="alt-av" style="background:${AV_BG[i % 5]};color:${AV_FG[i % 5]}">${esc(initials)}</span><span><button type="button" class="alt-name" data-inspect="${esc(r.id)}">${esc(r.name)}</button><small class="mono faint">${esc(r.id)}</small></span></span><span>${badge(r.tri, r.level)}</span><span class="alt-bars" role="img" aria-label="${esc(GROUP_NAMES.map(g => g + ' ' + (r.groups[g] ?? 'unknown')).join(', '))}">${bars}</span><span class="mono">${r.delivery == null ? '—' : r.delivery.toFixed(1) + ' %'}</span><span class="mono muted2">${r.po == null ? '—' : compactEur.format(r.po)}</span><span class="muted2">${esc(r.sourcing || '—')}</span><button type="button" class="alt-cmp ${on ? 'on' : ''}" data-alt-compare="${esc(r.id)}" aria-pressed="${on}">${on ? 'Added' : '+ Compare'}</button></div>`;
  }).join('');
  return `<div class="card alt-card rise"><div class="alt-head"><div><b>Top ${alt.suppliers.length} alternatives</b><small>${alt.matched.toLocaleString()} of ${alt.total.toLocaleString()} match · ${esc(alt.criteria)}</small></div><div class="alt-actions"><button type="button" class="pill grey" data-alt-open="${esc(job.id)}">Open in Compare</button><button type="button" class="pill black" data-memo>Generate memo</button></div></div><div class="alt-scroll"><div class="alt-grid" role="table"><div class="alt-row alt-th" role="row"><span>#</span><span>Supplier</span><span>Risk (TRI)</span><span>Profile</span><span>Delivery</span><span>PO vol.</span><span>Sourcing</span><span></span></div>${rows || '<p class="muted pad">No supplier passes this screen.</p>'}</div></div><div class="alt-legend"><span>Profile: ${GROUP_NAMES.join(' · ')}</span>${['Low', 'Medium', 'High', 'Critical'].map((l, i) => `<span><i style="background:${color([10, 30, 60, 90][i])}"></i>${l}</span>`).join('')}<span class="push">0–100, higher = riskier · anonymized dataset suppliers</span></div></div>`;
}
function verdictCard(job) {
  const v = job.verdict, word = v?.word || 'Review';
  return `<div class="card verdict rise"><span class="faint">Verdict on ${esc(job.company)}</span><div class="verdict-line"><span class="verdict-word v-${esc(word.toLowerCase())}">${esc(word)}</span><span class="verdict-sub">${v ? cite(esc(v.reason), job) : 'Nemotron gave no explicit verdict. Read the brief.'}</span></div>${job.citation_warning ? '<div class="notice">Citation check incomplete: some claims may not be linked to a source.</div>' : ''}<details class="brief-box" open><summary>Cited brief</summary><div class="report-md">${cite(md(job.report || ''), job)}</div></details><p class="faint small">Web evidence for the named company only; it is not linked to any anonymized dataset ID. Dataset scores use 0–100, higher = riskier.</p></div>`;
}
function renderTurn(el, job) {
  const steps = job.steps || [], finished = ['done', 'error'].includes(job.status);
  const est = finished ? steps.length : Math.max(steps.length + 1, job.question ? 9 : 8), doneN = steps.filter(s => s.state === 'done').length;
  if (job.company) $('#thread-title').textContent = `${job.company} — ${job.context}`;
  const plan = `<div class="card plan"><div class="plan-head"><b>Research plan</b><span class="mono faint">${doneN} / ${est}</span><span class="progress"><span style="width:${Math.round(doneN / Math.max(est, 1) * 100)}%"></span></span></div><ol>${steps.map(s => planStep(s, job)).join('') || '<li class="plan-step running"><span class="plan-icon"><span class="spin"></span></span><span class="plan-body"><span class="plan-title"><span>Queued</span></span></span></li>'}</ol></div>`;
  let body = '';
  if (job.status === 'error') body = `<div class="card error-card rise"><b>Research stopped</b><p>${esc(job.error || 'Unknown error')}</p><p class="faint small">No result was simulated. Fix the cause and ask again.</p></div>`;
  if (job.status === 'done') {
    const sources = (job.sources || []).map(s => `<a class="src rise" id="src-${esc(job.id)}-${s.id}" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer"><span class="src-n mono">${s.id}</span><span class="src-t"><span>${esc(s.title)}</span><small>${esc(host(s.url))}${s.published ? ' · ' + esc(s.published) : ''}</small></span></a>`).join('');
    const top = job.alternatives?.suppliers || [];
    const chips = [top.length > 1 && ['data', `Which of ${top.slice(0, 5).map(r => r.id).join(', ')} has the lowest financial risk? Inspect them.`, 'Which of the top 5 has the lowest financial risk?'],
                   top.length > 1 && ['data', `Why does ${top[0].id} rank above ${top[1].id}? Inspect both records.`, `Why is ${top[0].id} ranked first?`],
                   ['research', `Dig deeper into ${job.company}: financial health, recent filings and delivery problems relevant to ${job.context}.`, `Dig deeper on ${job.company} financials`]].filter(Boolean);
    body = verdictCard(job) + altTable(job) + (sources ? `<div class="sources-block rise"><span class="faint">Sources</span><div class="src-grid">${sources}</div></div>` : '') + `<div class="chips rise">${chips.map(([m, q, l]) => `<button type="button" class="chip-q" data-${m === 'data' ? 'ask-data' : 'ask'}="${esc(q)}">${esc(l)}</button>`).join('')}</div>`;
    lastResearch = job;
  }
  el.innerHTML = turnHead(!finished, finished ? (job.status === 'done' ? `${(job.sources || []).length} sources · ${job.elapsed} s` : 'stopped') : statusText(job)) + plan + body;
}
function pollTurn(id, el) {
  clearTimeout(polls.get(id));
  const tick = async () => {
    try { const job = await api('/research/' + id); renderTurn(el, job); if (!['done', 'error'].includes(job.status)) polls.set(id, setTimeout(tick, 1200)); else { polls.delete(id); loadRecent(); $('#research-dot').className = 'tiny-dot ' + (job.status === 'done' ? 'green' : 'red'); } }
    catch (e) { el.innerHTML = turnHead(false, 'stopped') + `<div class="card error-card"><p>${esc(e.message)}</p></div>`; }
  };
  tick();
}
async function askResearch(q) {
  addBubble(q); const el = addTurn(); el.innerHTML = turnHead(true, 'Planning');
  $('#thread-title').textContent = q.length > 70 ? q.slice(0, 70) + '…' : q;
  try { const {job_id} = await api('/research', {question:q, context:'Supplier procurement'}); $('#research-dot').className = 'tiny-dot running'; pollTurn(job_id, el); }
  catch (e) { el.innerHTML = turnHead(false, 'stopped') + `<div class="card error-card"><b>Could not start research</b><p>${esc(e.message)}</p></div>`; }
}
async function askData(q) {
  if (dataBusy) return;
  if (!service?.providers.nemotron.configured) { toast('Add NEBIUS_API_KEY to the server configuration to enable Nemotron.'); return; }
  dataBusy = true; addBubble(q); const el = addTurn(); el.innerHTML = turnHead(true, 'Reading 10,000 supplier records');
  try {
    gather(); const data = await api('/chat', {message:q, selection}); transcript.push({role:'buyer', text:q}, {role:'nemotron', text:data.reply}); lastModel = data.model;
    result = data.selection; render();
    if (data.comparison) { data.comparison.suppliers.forEach(s => { if (compared.size < 20) compared.add(s.id); }); syncCompare(); }
    const trace = data.trace.length ? data.trace.map(t => `<span>${t.status === 'done' ? '✓' : '!'} ${esc(t.tool.replaceAll('_', ' '))}${t.detail ? ' · ' + esc(t.detail) : ''}</span>`).join('') : '<span>Answered without tools</span>';
    el.innerHTML = turnHead(false, data.model) + `<div class="card answer rise"><div class="report-md">${md(data.reply)}</div><div class="trace mono">${trace}</div>${data.comparison ? '<button type="button" class="pill grey" id="trace-compare">Open the inspected records in Compare</button>' : ''}</div>`;
    if (data.job_id) { const t = addTurn(); pollTurn(data.job_id, t); }
  } catch (e) { el.innerHTML = turnHead(false, 'stopped') + `<div class="card error-card"><p>${esc(e.message)}</p></div>`; }
  finally { dataBusy = false; }
}
async function loadRecent() {
  try {
    const {jobs} = await api('/research');
    $('#recent').innerHTML = jobs.slice(0, 4).map(j => `<button type="button" data-open-turn="${esc(j.id)}" title="${esc(j.question || j.company)}"><span>${esc(j.company || 'Research')}</span>${j.verdict ? `<small class="v-${esc(j.verdict.toLowerCase())}">${esc(j.verdict)}</small>` : ''}</button>`).join('') || '<p class="side-empty">Your research appears here.</p>';
  } catch { $('#recent').innerHTML = ''; }
}
function setMode(m) {
  mode = m; document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('#ask').placeholder = m === 'research' ? 'Ask Gauge about a supplier or a purchase…' : 'Ask about the supplier dataset…';
}
function submitAsk(q, m = mode) { q = q.trim(); if (!q) return; if (m === 'research' && q.length < 3) { toast('Write a full question that names the company, e.g. “Is it OK to buy from French company X now?”'); return; } $('#ask').value = ''; if (m === 'data') askData(q); else askResearch(q); }
$('#ask-form').onsubmit = e => { e.preventDefault(); submitAsk($('#ask').value); };
$('#ask').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask-form').requestSubmit(); } };
$('#reset').addEventListener('click', () => { polls.forEach(t => clearTimeout(t)); polls.clear(); thread.innerHTML = heroHtml; $('#thread-title').textContent = 'New research'; setMode('research'); $('#ask').focus(); });
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mode) setMode(b.dataset.mode);
  if (b.dataset.ask) { setMode('research'); submitAsk(b.dataset.ask, 'research'); }
  if (b.dataset.askData) { setMode('data'); submitAsk(b.dataset.askData, 'data'); }
  if (b.dataset.altCompare) { const id = b.dataset.altCompare; if (compared.has(id)) compared.delete(id); else if (compared.size < 20) compared.add(id); else toast('Compare supports up to 20 suppliers.'); syncCompare(); }
  if (b.dataset.altOpen) { if (!compared.size) (lastResearch?.alternatives?.suppliers || []).slice(0, 3).forEach(r => compared.add(r.id)); syncCompare(); showCompare(); }
  if (b.dataset.memo !== undefined) downloadMemo();
  if (b.dataset.openTurn) { $('#hero')?.remove(); pollTurn(b.dataset.openTurn, addTurn()); }
});
loadRecent();
init();

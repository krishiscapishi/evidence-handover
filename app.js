const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const dialog = document.querySelector('#sourceDialog');
let workspace = null;
let selectedFiles = [];
let activeRole = 'reviewer';
let toastTimer;

const kindLabels = { decision: 'Decisions', task: 'Tasks', risk: 'Risks', dependency: 'Dependencies', question: 'Open questions' };
const kindOrder = ['decision', 'task', 'risk', 'dependency', 'question'];
const iconFor = { decision: '◈', task: '✓', risk: '△', dependency: '↗', question: '?' };

async function api(path, method = 'GET', data) {
  const options = { method, headers: {} };
  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function shortBytes(n) { return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`; }
function notify(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}
function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) { button.dataset.original = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.original || button.textContent; button.disabled = false; }
}

async function refresh() {
  workspace = await api('/api/state');
  document.querySelector('#resetBtn').hidden = !workspace.project;
  render();
}

function landingView() {
  return `
    <section class="hero">
      <div>
        <span class="eyebrow">KNOWLEDGE THAT MOVES WITH THE WORK</span>
        <h1>Leave the next person a <em>head start.</em></h1>
        <p class="hero-copy">Relay turns scattered project notes into a handover your team can check, correct and trust. Every draft item points back to its source.</p>
        <div class="hero-actions">
          <button class="button button-primary" data-action="demo">Explore the demo <span aria-hidden="true">→</span></button>
          <button class="button button-quiet" data-action="new">Create a handover</button>
        </div>
        <p class="hero-note">Try the sample workspace first. No account or setup needed.</p>
      </div>
      <div class="visual-card" aria-label="Handover process preview">
        <div class="visual-label">FROM PROJECT RECORDS TO A CLEAR NEXT STEP</div>
        <div class="flow-stack">
          <div class="flow-row"><span class="flow-icon">▤</span><div><strong>Bring the context together</strong><span>Notes, decisions and open work</span></div><span class="flow-check">✓</span></div>
          <div class="flow-row"><span class="flow-icon">⌕</span><div><strong>Keep every claim traceable</strong><span>Evidence linked to source lines</span></div><span class="flow-check">✓</span></div>
          <div class="flow-row"><span class="flow-icon">↗</span><div><strong>Review, then hand it over</strong><span>A person approves the final brief</span></div><span class="flow-check">✓</span></div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-heading"><div><span class="eyebrow">HOW RELAY WORKS</span><h2>Context, with a clear chain of evidence.</h2></div><p>Built around a human reviewed handover.</p></div>
      <div class="feature-grid">
        <article class="feature-card"><span class="num">01 / COLLECT</span><h3>Start with the project record</h3><p>Bring together approved meeting notes, decisions and task exports in one workspace.</p></article>
        <article class="feature-card"><span class="num">02 / REVIEW</span><h3>Check the source behind each item</h3><p>See where a draft came from, correct it, or reject it when the evidence does not support it.</p></article>
        <article class="feature-card"><span class="num">03 / HAND OVER</span><h3>Share an approved next step</h3><p>Give the incoming teammate a focused view of what happened and what still needs attention.</p></article>
      </div>
    </section>`;
}

function setupView() {
  const projectName = workspace?.project?.name || '';
  const hasSources = workspace?.sources?.length > 0;
  return `
    <div class="workspace-head"><div><div class="crumb">Workspace <span>›</span> New handover</div><span class="eyebrow">STEP 1 · ADD PROJECT CONTEXT</span><h1 class="page-title">Create a handover</h1><p class="subtitle">Bring together a few approved project records to get started.</p></div><div class="head-actions"><button class="button button-quiet" data-action="home">Cancel</button></div></div>
    ${stepper(0)}
    <div class="columns">
      <section class="panel panel-pad">
        <h2 class="panel-title">Project details</h2><p class="panel-sub">Give the incoming teammate enough context to recognize the work.</p>
        <div style="margin-top:19px"><label class="field-label" for="projectName">Project name</label><input id="projectName" class="text-field" placeholder="e.g. Atlas university pilot" value="${escapeHtml(projectName)}"><p class="input-hint">You can change this later.</p></div>
        <div class="upload-box">
          <div class="upload-icon">↑</div><h3>Add project files</h3><p>Choose text, Markdown or CSV files. Keep uploads under 1.5 MB total.</p>
          <label class="file-label" for="filePicker">Choose files</label><input class="file-input" id="filePicker" type="file" multiple accept=".txt,.md,.csv,text/plain,text/markdown,text/csv">
          <div id="fileList" class="file-list">${selectedFiles.length ? selectedFiles.map(fileRow).join('') : ''}</div>
        </div>
        <div class="notice notice-info">For this demo, use synthetic or approved project material. Relay currently accepts .txt, .md and .csv files.</div>
        <button class="button button-primary" data-action="save-sources" ${selectedFiles.length ? '' : 'disabled'}>Save sources and continue →</button>
      </section>
      <aside class="right-panel">
        <div class="progress-card"><div class="progress-top"><span>Your handover</span><span>1 of 3</span></div><div class="progress-bar"><i style="width:33%"></i></div></div>
        <div class="mini-card"><h3>Good starter files</h3><div class="mini-list"><div class="mini-row"><i class="mini-dot"></i><span>Meeting notes with decisions and owners</span></div><div class="mini-row"><i class="mini-dot"></i><span>Task or issue list with current status</span></div><div class="mini-row"><i class="mini-dot"></i><span>A short decision or risk log</span></div></div></div>
        <div class="mini-card"><h3>Source first</h3><p>Draft items stay marked for review. A teammate must check each one before the handover can be shared.</p></div>
      </aside>
    </div>`;
}

function fileRow(file, index) {
  const ext = file.name.split('.').pop().slice(0, 3).toUpperCase();
  return `<div class="file-row"><span class="file-type">${escapeHtml(ext)}</span><span><strong>${escapeHtml(file.name)}</strong><small>${shortBytes(file.size)}</small></span><button class="file-remove" data-action="remove-file" data-index="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button></div>`;
}

function stepper(active) {
  const stages = ['Add sources', 'Review draft', 'Share handover'];
  return `<div class="stepper">${stages.map((label, i) => `<div class="step ${i < active ? 'done' : i === active ? 'active' : ''}"><span class="step-num">${i < active ? '✓' : i + 1}</span>${label}</div>${i < 2 ? '<div class="step-line"></div>' : ''}`).join('')}</div>`;
}

function counts() {
  const map = {};
  for (const kind of kindOrder) map[kind] = workspace.items.filter(item => item.kind === kind).length;
  return map;
}

function sourceSidebar() {
  const rows = workspace.sources.map(source => `<div class="source-chip"><span class="file-type">SRC</span><div><strong>${escapeHtml(source.name)}</strong><small>${source.characters.toLocaleString()} characters</small></div><button data-action="source" data-id="${source.id}">View</button></div>`).join('');
  return `<div class="mini-card"><h3>Project sources <span class="kind-count">${workspace.sources.length}</span></h3><div class="source-list">${rows}</div><button class="button button-quiet button-small" style="margin-top:11px;width:100%" data-action="add-more">+ Add more files</button></div>`;
}

function countStrip() {
  const map = counts();
  return `<div class="summary-strip">${kindOrder.map(kind => `<span class="summary-pill"><b>${map[kind]}</b> ${kindLabels[kind].toLowerCase()}</span>`).join('')}</div>`;
}

function itemCard(item, readonly = false) {
  const statusText = { needs_review: 'Needs review', approved: 'Approved', rejected: 'Rejected' }[item.status];
  const actions = readonly ? '' : `<textarea class="edit-area" aria-label="Edit ${escapeHtml(kindLabels[item.kind])}" data-edit="${item.id}">${escapeHtml(item.content)}</textarea><div class="item-actions"><button class="button button-approve" data-action="approve-item" data-id="${item.id}">✓ Approve</button><button class="button button-reject" data-action="reject-item" data-id="${item.id}">Reject</button><button class="button button-quiet button-small" data-action="save-item" data-id="${item.id}">Save edit</button></div>`;
  return `<article class="item-card"><div class="item-top"><span class="eyebrow">${iconFor[item.kind]} &nbsp;${escapeHtml(kindLabels[item.kind].slice(0, -1).toUpperCase())}</span><span class="status status-${item.status}">${statusText}</span></div>${readonly ? `<p class="item-text">${escapeHtml(item.content)}</p>` : `<p class="item-text" hidden>${escapeHtml(item.content)}</p>`}<a class="citation" href="#" data-action="source" data-id="${item.source_id}" aria-label="View source ${escapeHtml(item.source_name)} lines ${item.start_line} to ${item.end_line}">↗ ${escapeHtml(item.source_name)} · lines ${item.start_line}–${item.end_line}</a>${actions}</article>`;
}

function groupedItems(items, readonly = false) {
  const filtered = items.filter(item => readonly ? item.status === 'approved' : true);
  return kindOrder.map(kind => {
    const rows = filtered.filter(item => item.kind === kind);
    if (!rows.length) return '';
    return `<section><div class="kind-heading">${iconFor[kind]} ${escapeHtml(kindLabels[kind])}<span class="kind-count">${rows.length}</span></div>${rows.map(item => itemCard(item, readonly)).join('')}</section>`;
  }).join('') || `<div class="empty-state"><h3>${readonly ? 'Nothing approved to share yet' : 'No draft items found'}</h3><p>${readonly ? 'Switch back to reviewer view, then approve the items that are ready.' : 'Try adding a meeting note with clear decisions, tasks, risks or open questions.'}</p></div>`;
}

function workspaceView() {
  const hasItems = workspace.items.length > 0;
  const active = workspace.project.approved ? 3 : hasItems ? 1 : 0;
  const pending = workspace.items.filter(item => item.status === 'needs_review').length;
  const approved = workspace.items.filter(item => item.status === 'approved').length;
  const rejected = workspace.items.filter(item => item.status === 'rejected').length;
  const recipient = activeRole === 'recipient';
  let central;
  if (!workspace.sources.length) {
    central = `<div class="panel panel-pad"><h2 class="panel-title">Add project sources</h2><p class="panel-sub">Start with meeting notes, a task export, or a decision log.</p><div class="upload-box"><div class="upload-icon">↑</div><h3>Choose files to upload</h3><p>Accepted: .txt, .md and .csv</p><label class="file-label" for="filePicker">Choose files</label><input class="file-input" id="filePicker" type="file" multiple accept=".txt,.md,.csv"><div id="fileList" class="file-list"></div></div><label class="field-label" for="projectName">Project name</label><input id="projectName" class="text-field" value="${escapeHtml(workspace.project.name)}"><button class="button button-primary" style="margin-top:14px" data-action="save-sources" ${selectedFiles.length ? '' : 'disabled'}>Save sources and continue →</button></div>`;
  } else if (!hasItems) {
    central = `<div class="panel panel-pad"><span class="eyebrow">STEP 2 · BUILD A DRAFT</span><h2 class="panel-title" style="margin-top:9px">Your sources are ready.</h2><p class="panel-sub">Relay will organize evidence into decisions, tasks, risks, dependencies and open questions. Every result will need human review.</p><div class="notice notice-info" style="margin-top:16px">${workspace.llm_configured ? 'AI extraction is configured for this workspace.' : 'Demo extraction is ready. Add labels such as DECISION:, TASK:, RISK:, DEPENDENCY: or QUESTION: to guide the results.'}</div><button class="button button-primary" data-action="generate">Build handover draft →</button></div>`;
  } else if (recipient && !workspace.project.approved) {
    central = `<div class="panel panel-pad"><div class="empty-state"><div class="upload-icon">↗</div><h3>The handover is still in review</h3><p>The reviewer must approve or reject each draft item before the incoming teammate can see the handover.</p><button class="button button-soft" style="margin-top:15px" data-action="role-reviewer">Return to reviewer view</button></div></div>`;
  } else if (recipient) {
    central = `<div class="handover-banner"><strong>Approved handover · Ready for the next teammate</strong><p>This brief includes the items a reviewer approved. Open any source citation to check the original project record.</p></div><div class="recipient-list">${workspace.items.filter(item => item.status === 'approved').map(item => `<article class="recipient-card"><div class="recipient-section">${escapeHtml(kindLabels[item.kind])}</div><p>${escapeHtml(item.content)}</p><a class="citation" href="#" data-action="source" data-id="${item.source_id}">↗ ${escapeHtml(item.source_name)} · lines ${item.start_line}–${item.end_line}</a></article>`).join('') || '<div class="empty-state"><h3>No approved items</h3><p>Ask the reviewer to approve at least one item.</p></div>'}</div>`;
  } else {
    central = `<div class="items-head"><div><h2>Handover draft</h2><p>${pending ? `${pending} item${pending === 1 ? '' : 's'} waiting for review` : workspace.project.approved ? 'All draft items have been reviewed.' : 'Review the evidence before sharing.'}</p></div><div class="role-switch"><button class="selected" data-action="role-reviewer">Reviewer</button><button data-action="role-recipient">Incoming teammate</button></div></div>${workspace.project.approved ? '<div class="notice notice-info">This handover is approved and ready for the incoming teammate.</div>' : ''}${countStrip()}${groupedItems(workspace.items)}`;
  }
  return `
    <div class="workspace-head"><div><div class="crumb">Workspace <span>›</span> ${escapeHtml(workspace.project.name)}</div><span class="eyebrow">PROJECT HANDOVER</span><h1 class="page-title">${escapeHtml(workspace.project.name)}</h1><p class="subtitle">A source-linked summary for the teammate picking up the work.</p></div><div class="head-actions">${workspace.project.approved ? (activeRole === 'recipient' ? '<button class="button button-soft" data-action="role-reviewer">← Reviewer view</button>' : '<button class="button button-soft" data-action="role-recipient">Open recipient view →</button>') : ''}<button class="button button-quiet" data-action="new">New handover</button></div></div>
    ${stepper(active)}
    ${workspace.warning ? `<div class="notice notice-warn">${escapeHtml(workspace.warning)}</div>` : ''}
    <div class="workspace-body"><section>${central}</section><aside class="right-panel">
      <div class="progress-card"><div class="progress-top"><span>Review progress</span><span>${approved + rejected}/${workspace.items.length || 0}</span></div><div class="progress-bar"><i style="width:${workspace.items.length ? Math.round((approved + rejected) / workspace.items.length * 100) : 0}%"></i></div><div class="checkline"><b>✓</b><span>${workspace.sources.length} project source${workspace.sources.length === 1 ? '' : 's'} connected</span></div><div class="checkline"><b>✓</b><span>${pending ? `${pending} draft item${pending === 1 ? '' : 's'} still need review` : workspace.items.length ? 'Every item has a review decision' : 'Build a draft to continue'}</span></div></div>
      ${sourceSidebar()}
      <div class="mini-card"><h3>Human review stays in control</h3><p>Draft text is not shared until a reviewer checks every item. Source links stay attached to the approved handover.</p></div>
      ${workspace.sources.length && !workspace.project.approved && hasItems ? `<button class="button button-primary" data-action="publish" ${pending ? 'disabled' : ''}>Approve and share handover →</button>` : ''}
      ${workspace.project.approved ? '<div class="complete-state">✓ Handover approved. Switch to incoming teammate view to see the final brief.</div>' : ''}
    </aside></div>`;
}

function render() {
  if (!workspace?.project) app.innerHTML = landingView();
  else if (workspace.project && !workspace.sources.length && !workspace.items.length) app.innerHTML = setupView();
  else app.innerHTML = workspaceView();
  bindFilePicker();
}

function bindFilePicker() {
  const picker = document.querySelector('#filePicker');
  if (!picker) return;
  picker.addEventListener('change', () => {
    const supported = [...picker.files].filter(file => /\.(txt|md|csv)$/i.test(file.name));
    const ignored = picker.files.length - supported.length;
    selectedFiles = [...selectedFiles, ...supported];
    if (ignored) notify(`${ignored} unsupported file${ignored === 1 ? '' : 's'} skipped. Choose .txt, .md or .csv.`);
    const list = document.querySelector('#fileList');
    if (list) list.innerHTML = selectedFiles.map(fileRow).join('');
    const save = document.querySelector('[data-action="save-sources"]');
    if (save) save.disabled = selectedFiles.length === 0;
  });
}

async function saveSources(button) {
  if (!selectedFiles.length) throw new Error('Choose at least one source file first.');
  setBusy(button, true, 'Reading files…');
  const files = await Promise.all(selectedFiles.map(async file => ({ name: file.name, content: await file.text() })));
  const projectName = document.querySelector('#projectName')?.value?.trim() || workspace?.project?.name || 'Untitled handover';
  workspace = await api('/api/sources', 'POST', { project_name: projectName, files });
  selectedFiles = [];
  render();
  notify('Sources saved. Build the draft when you’re ready.');
}

async function openSource(id) {
  const source = await api(`/api/sources/${id}`);
  document.querySelector('#sourceTitle').textContent = source.name;
  document.querySelector('#sourceContent').textContent = source.content.split('\n').map((line, i) => `${String(i + 1).padStart(3, ' ')}  ${line}`).join('\n');
  dialog.hidden = false;
}

async function updateItem(id, status, button) {
  const textarea = document.querySelector(`[data-edit="${id}"]`);
  const item = workspace.items.find(row => row.id === Number(id));
  const content = textarea?.value?.trim() || item?.content;
  if (!content) throw new Error('Add a short summary before saving.');
  setBusy(button, true, 'Saving…');
  workspace = await api(`/api/items/${id}`, 'PATCH', { content, status });
  render();
  notify(status === 'approved' ? 'Item approved with its source citation.' : status === 'rejected' ? 'Item rejected.' : 'Edit saved.');
}

app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  const action = target.dataset.action;
  try {
    if (action === 'demo') {
      setBusy(target, true, 'Opening demo…');
      workspace = await api('/api/demo', 'POST', {}); activeRole = 'reviewer'; render(); notify('Sample handover loaded. Review the evidence cards.');
    } else if (action === 'new') {
      workspace = { project: { id: null, name: '', approved: false }, sources: [], items: [], llm_configured: false }; selectedFiles = []; activeRole = 'reviewer'; render();
    } else if (action === 'home') {
      selectedFiles = []; workspace = { project: null, sources: [], items: [] }; render();
    } else if (action === 'save-sources') {
      await saveSources(target);
    } else if (action === 'remove-file') {
      selectedFiles.splice(Number(target.dataset.index), 1); render();
    } else if (action === 'generate') {
      setBusy(target, true, 'Building draft…');
      workspace = await api('/api/generate', 'POST', {}); render();
      notify(workspace.ai_used ? 'AI draft created. Review every item and its evidence.' : 'Evidence candidates created. Review and edit them before sharing.');
    } else if (action === 'source') {
      await openSource(target.dataset.id);
    } else if (action === 'approve-item') {
      await updateItem(target.dataset.id, 'approved', target);
    } else if (action === 'reject-item') {
      await updateItem(target.dataset.id, 'rejected', target);
    } else if (action === 'save-item') {
      await updateItem(target.dataset.id, 'needs_review', target);
    } else if (action === 'publish') {
      setBusy(target, true, 'Approving…');
      workspace = await api('/api/approve', 'POST', {}); activeRole = 'recipient'; render(); notify('The approved handover is ready for the incoming teammate.');
    } else if (action === 'role-reviewer') {
      activeRole = 'reviewer'; render();
    } else if (action === 'role-recipient') {
      activeRole = 'recipient'; render();
    } else if (action === 'add-more') {
      selectedFiles = [];
      app.innerHTML = setupView();
      const title = document.querySelector('#projectName'); if (title) title.value = workspace.project.name;
      bindFilePicker();
    }
  } catch (error) {
    notify(error.message || 'Something went wrong. Please try again.');
    const busy = document.querySelector('button[disabled][data-original]');
    if (busy) setBusy(busy, false);
  }
});

document.querySelector('#resetBtn').addEventListener('click', async () => {
  if (!confirm('Clear the current demo workspace and start over?')) return;
  try { workspace = await api('/api/reset', 'POST', {}); selectedFiles = []; activeRole = 'reviewer'; render(); }
  catch (error) { notify(error.message); }
});
document.querySelector('#closeDialog').addEventListener('click', () => { dialog.hidden = true; });
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.hidden = true; });

refresh().catch(error => {
  app.innerHTML = `<div class="empty-state"><h3>Relay could not reach its server</h3><p>${escapeHtml(error.message)} Start the app using the instructions in README.md, then refresh this page.</p></div>`;
});

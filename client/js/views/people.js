/* Mentor/admin: people (create mentors & learners), cohorts, assigned goals. */
window.Views = window.Views || {};
(function () {
  'use strict';

  Views.people = async function ({ query }) {
    let tab = ['people', 'cohorts', 'assigned'].includes(query.tab) ? query.tab : 'people';
    let users = (await API.adminUsers()).users;
    let cohorts = (await API.cohorts()).cohorts;
    let assigned = null;
    const root = h('div');
    const body = h('div', { class: 'page-enter' });
    const meId = App.user.id;

    const secret = (title, text, pw) => UI.modal((close) => h('div', null,
      h('h2', null, title), h('p', { class: 'sub' }, text),
      h('div', { class: 'secret' }, h('code', null, pw), h('button', { class: 'icon-btn', 'aria-label': 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(pw); UI.toast('Copied'); } catch { UI.toast('Select it and copy', 'info'); } } }, Icon('copy'))),
      h('p', { class: 'hint' }, 'This is shown once and is not stored in readable form. Ask them to change it from Settings after signing in.'),
      h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: close }, 'Done'))));

    /* ----- add / edit person ----- */
    function personModal(u) {
      UI.modal((close) => {
        const name = h('input', { class: 'input', name: 'name', maxlength: 80, value: u ? u.name : '', placeholder: 'Full name' });
        const email = h('input', { class: 'input', name: 'email', type: 'email', value: u ? u.email : '', disabled: !!u, placeholder: 'name@example.com' });
        const role = h('select', { class: 'select', name: 'role', disabled: u && u.id === meId }, h('option', { value: 'learner' }, 'Learner'), h('option', { value: 'mentor' }, 'Mentor / admin'));
        role.value = u ? u.role : 'learner';
        const pw = h('input', { class: 'input', name: 'password', type: 'text', autocomplete: 'off', placeholder: 'Leave blank to generate one' });
        const save = h('button', { class: 'btn primary', type: 'submit' }, u ? 'Save' : 'Create account');
        const form = h('form', { novalidate: true }, UI.field('Name', name, 'name'), UI.field('Email', email, 'email'), UI.field('Role', role, 'role', u && u.id === meId ? 'You can’t change your own role' : 'Mentors can see everyone, assign goals, approve and change settings'), u ? null : UI.field('Password', pw, 'password', 'Optional — a strong temporary password is generated if empty'), h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), save));
        form.addEventListener('submit', (e) => {
          e.preventDefault(); UI.clearErrors(form);
          UI.withBusy(save, async () => {
            try {
              if (u) { await API.adminUpdateUser(u.id, { name: name.value, role: role.value }); close(); UI.toast('Saved'); }
              else {
                const r = await API.adminCreateUser({ name: name.value, email: email.value, role: role.value, password: pw.value || undefined });
                close(); UI.toast(`${r.user.role === 'mentor' ? 'Mentor' : 'Learner'} created`);
                if (r.tempPassword) secret('Temporary password', `Give this to ${r.user.name} so they can sign in as ${r.user.email}.`, r.tempPassword);
              }
              await load(); paint();
            } catch (err) { UI.applyApiError(form, err); }
          });
        });
        return h('div', null, h('h2', null, u ? 'Edit person' : 'Add a person'), h('p', { class: 'sub' }, u ? u.email : 'Create a learner, or another mentor — no command line needed.'), form);
      });
    }
    async function toggleActive(u) {
      const ok = u.active ? await UI.confirm({ title: `Deactivate ${u.name}?`, body: 'They are signed out and can’t sign in again until you reactivate them. Their data is kept.', confirmLabel: 'Deactivate', danger: true, icon: 'lock' }) : true;
      if (!ok) return;
      try { await API.adminUpdateUser(u.id, { active: !u.active }); UI.toast(u.active ? 'Deactivated' : 'Reactivated', 'info'); await load(); paint(); } catch (err) { UI.toast(err.message, 'err'); }
    }
    async function resetPw(u) {
      const ok = await UI.confirm({ title: `Reset ${u.name}'s password?`, body: 'A new temporary password is generated and the old one stops working immediately.', confirmLabel: 'Reset password', icon: 'key' });
      if (!ok) return;
      try { const r = await API.adminResetPassword(u.id); secret('New temporary password', `For ${u.name} (${u.email}).`, r.tempPassword); } catch (err) { UI.toast(err.message, 'err'); }
    }

    /* ----- cohorts ----- */
    function cohortModal(c) {
      UI.modal((close) => {
        const learners = users.filter((u) => u.role === 'learner' && u.active);
        const chosen = new Set(c ? c.memberIds : []);
        const name = h('input', { class: 'input', name: 'name', maxlength: 60, value: c ? c.name : '', placeholder: 'e.g. Autumn 2026 batch' });
        const desc = h('input', { class: 'input', name: 'description', maxlength: 300, value: c ? c.description : '', placeholder: 'Optional' });
        const list = h('div', { class: 'checklist' }, learners.length ? learners.map((u) => { const cb = h('input', { type: 'checkbox', checked: chosen.has(u.id) }); const row = h('label', { class: `check${chosen.has(u.id) ? ' on' : ''}` }, cb, h('span', null, u.name), h('small', { class: 'hint', style: { marginLeft: 'auto' } }, u.email)); cb.addEventListener('change', () => { cb.checked ? chosen.add(u.id) : chosen.delete(u.id); row.classList.toggle('on', cb.checked); }); return row; }) : h('div', { class: 'hint' }, 'No active learners yet.'));
        const save = h('button', { class: 'btn primary', type: 'submit' }, c ? 'Save cohort' : 'Create cohort');
        const form = h('form', { novalidate: true }, UI.field('Name', name, 'name'), UI.field('Description', desc, 'description'), h('div', { class: 'field', 'data-name': 'members' }, h('label', null, 'Members'), list, h('div', { class: 'err' })), h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), save));
        form.addEventListener('submit', (e) => {
          e.preventDefault(); UI.clearErrors(form);
          UI.withBusy(save, async () => {
            try { const body = { name: name.value, description: desc.value, memberIds: [...chosen] }; if (c) await API.updateCohort(c.id, body); else await API.createCohort(body); close(); UI.toast(c ? 'Cohort updated' : 'Cohort created'); await load(); paint(); }
            catch (err) { UI.applyApiError(form, err); }
          });
        });
        return h('div', null, h('h2', null, c ? 'Edit cohort' : 'New cohort'), h('p', { class: 'sub' }, 'A cohort is a batch of learners you can assign a goal to in one go.'), form);
      });
    }
    async function delCohort(c) {
      if (!(await UI.confirm({ title: `Delete “${c.name}”?`, body: 'Only the grouping is removed. Learners and the goals already assigned to them are not affected.', confirmLabel: 'Delete cohort', danger: true, icon: 'trash' }))) return;
      try { await API.deleteCohort(c.id); UI.toast('Cohort deleted', 'info'); await load(); paint(); } catch (err) { UI.toast(err.message, 'err'); }
    }

    async function load() { [users, cohorts] = await Promise.all([API.adminUsers().then((r) => r.users), API.cohorts().then((r) => r.cohorts)]); if (tab === 'assigned') assigned = (await API.assignedGoals()).assigned; }

    function peopleTab() {
      return h('div', { class: 'list' }, users.map((u, i) => h('article', { class: `card li person reveal${u.active ? '' : ' off'}`, style: { '--i': Math.min(i, 8), padding: '14px 18px' } },
        h('div', { class: 'avatar' }, UI.initials(u.name)),
        h('div', { class: 'grow' }, h('b', null, u.name, u.id === meId ? h('span', { class: 'you' }, 'you') : null), h('small', null, u.email), u.cohorts.length ? h('small', null, u.cohorts.map((c) => c.name).join(' · ')) : null),
        h('span', { class: `pill ${u.role === 'mentor' ? 'available' : 'complete'}` }, u.role === 'mentor' ? 'Mentor' : 'Learner'),
        !u.active ? h('span', { class: 'pill locked' }, 'Inactive') : null,
        h('div', { class: 'actions' },
          h('button', { class: 'icon-btn', 'aria-label': `Edit ${u.name}`, title: 'Edit', onclick: () => personModal(u) }, Icon('edit')),
          h('button', { class: 'icon-btn', 'aria-label': `Reset password for ${u.name}`, title: 'Reset password', onclick: () => resetPw(u) }, Icon('key')),
          u.id !== meId ? h('button', { class: 'icon-btn', 'aria-label': u.active ? 'Deactivate' : 'Reactivate', title: u.active ? 'Deactivate' : 'Reactivate', onclick: () => toggleActive(u) }, Icon(u.active ? 'lock' : 'unlock')) : null))));
    }
    function cohortsTab() {
      return cohorts.length ? h('div', { class: 'grid g-2' }, cohorts.map((c, i) => h('article', { class: 'card tilt cohort reveal', style: { '--i': i } },
        h('div', { class: 'card-head' }, h('div', null, h('h3', null, c.name), c.description ? h('p', { class: 'sub' }, c.description) : null), h('div', { class: 'actions' }, h('button', { class: 'icon-btn', 'aria-label': 'Edit cohort', onclick: () => cohortModal(c) }, Icon('edit')), h('button', { class: 'icon-btn', 'aria-label': 'Delete cohort', onclick: () => delCohort(c) }, Icon('trash')))),
        h('div', { class: 'grid g-4 coh-stats' }, [[c.stats.learners, 'learners'], [c.stats.avgPercent + '%', 'avg progress'], [UI.fmtMin(c.stats.weekMinutes), 'this week'], [c.stats.atRisk, 'goals at risk']].map(([v, l]) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l)))),
        c.stats.pendingApprovals ? h('div', { class: 'banner', style: { margin: '12px 0 0' } }, Icon('hourglass'), h('span', null, `${c.stats.pendingApprovals} topic${c.stats.pendingApprovals === 1 ? '' : 's'} awaiting approval`)) : null,
        h('div', { class: 'avatars' }, c.members.length ? c.members.map((m) => h('a', { class: 'avatar', href: `#/learners/${m.id}`, title: m.name, 'aria-label': m.name }, UI.initials(m.name))) : h('span', { class: 'hint' }, 'No members yet'))))) : h('div', { class: 'card empty' }, Icon('users'), h('h3', null, 'No cohorts yet'), h('p', null, 'Group learners into a batch, then assign a goal to everyone at once.'), h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => cohortModal() }, Icon('plus'), 'Create a cohort')));
    }
    function assignedTab() {
      if (!assigned) return UI.skeleton(2, 80);
      return assigned.length ? h('div', { class: 'list' }, assigned.map((a, i) => h('a', { class: 'card li click reveal', href: `#/goals/${a.id}`, style: { '--i': Math.min(i, 8), padding: '14px 18px', textDecoration: 'none', color: 'inherit' } },
        h('span', { class: 'sico available' }, Icon('send')), h('div', { class: 'grow' }, h('b', null, a.title), h('small', null, `${a.learnerName}${a.targetDate ? ' · target ' + UI.fmtDate(a.targetDate) : ''}`)),
        h('div', { class: 'end' }, `${a.complete}/${a.topics}`, h('small', null, 'topics')), a.pending ? h('span', { class: 'pill pending' }, Icon('hourglass'), `${a.pending} to review`) : null, a.requireApproval ? h('span', { class: 'chip' }, Icon('shield'), 'Approval') : null)))
        : h('div', { class: 'card empty' }, Icon('send'), h('h3', null, 'Nothing assigned yet'), h('p', null, 'Assign a goal to learners or a cohort.'), h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: '#/assign' }, 'Assign a goal')));
    }

    function paint() {
      const actions = tab === 'people' ? h('button', { class: 'btn primary', onclick: () => personModal() }, Icon('userplus'), 'Add person')
        : tab === 'cohorts' ? h('button', { class: 'btn primary', onclick: () => cohortModal() }, Icon('plus'), 'New cohort') : h('a', { class: 'btn primary', href: '#/assign' }, Icon('send'), 'Assign a goal');
      const sub = tab === 'people' ? `${users.length} accounts · ${users.filter((u) => u.role === 'mentor').length} mentors` : tab === 'cohorts' ? `${cohorts.length} cohort${cohorts.length === 1 ? '' : 's'}` : 'Goals you assigned to learners';
      root.replaceChildren(
        h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'People & cohorts'), h('p', { class: 'sub' }, sub)), h('div', { class: 'actions' }, actions)),
        h('div', { style: { margin: '0 0 18px' } }, h('div', { class: 'tabs', role: 'tablist' }, [['people', 'People'], ['cohorts', 'Cohorts'], ['assigned', 'Assigned goals']].map(([k, l]) => h('button', { role: 'tab', class: tab === k ? 'on' : '', onclick: async () => { tab = k; if (k === 'assigned' && !assigned) { paint(); await load(); } paint(); } }, l)))),
        h('div', { class: 'page-enter' }, tab === 'people' ? peopleTab() : tab === 'cohorts' ? cohortsTab() : assignedTab()));
    }
    paint();
    void body;
    return root;
  };
})();

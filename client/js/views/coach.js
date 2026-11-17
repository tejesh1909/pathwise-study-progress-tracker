/* Study coach chat: answers from the learner's real progress. */
window.Views = window.Views || {};
(function () {
  'use strict';
  Views.coach = async function () {
    const history = [];
    const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
    const chipsBox = h('div', { class: 'qchips' });
    const input = h('input', { class: 'input', placeholder: 'Ask about your progress, deadlines or what to study next…', maxlength: 500, 'aria-label': 'Message' });
    const send = h('button', { class: 'btn primary', type: 'submit', 'aria-label': 'Send' }, Icon('send'));
    const bubble = (role, text, src) => {
      const b = h('div', { class: `bubble ${role}` }, ...String(text).split('\n').map((l, i) => (i ? [h('br'), l] : l)).flat(), src ? h('small', { class: 'src' }, Icon('sparkles'), src === 'gemini' ? 'Gemini' : 'Built-in coach') : null);
      log.append(b);
      log.scrollTop = log.scrollHeight;
      return b;
    };
    const ask = async (text) => {
      text = text.trim();
      if (!text) return;
      bubble('me', text);
      input.value = '';
      const typing = h('div', { class: 'bubble ai typing' }, h('i'), h('i'), h('i'));
      log.append(typing); log.scrollTop = log.scrollHeight;
      send.disabled = true;
      try {
        const r = await API.coach(text, history.slice(-8));
        typing.remove();
        bubble('ai', r.reply, r.source);
        history.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply });
        if (r.chips && !chipsBox.children.length) r.chips.forEach((c) => chipsBox.append(h('button', { type: 'button', onclick: () => ask(c) }, c)));
      } catch (err) { typing.remove(); bubble('ai', err.message); }
      send.disabled = false; input.focus();
    };
    const form = h('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, send);
    const root = h('div', null,
      h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Study coach'), h('p', { class: 'sub' }, 'Knows your goals, locks, deadlines and recent sessions. Answers come from your data.'))),
      h('section', { class: 'card chat reveal' }, log, chipsBox, form));
    bubble('ai', `Hi ${App.user.name.split(' ')[0]} — ask me what to study next, whether you are on track, or what is still locked.`, null);
    ['What should I study next?', "What's still locked?", 'Am I on track for my deadlines?', 'How was my week?'].forEach((c) => chipsBox.append(h('button', { type: 'button', onclick: () => ask(c) }, c)));
    return root;
  };
})();

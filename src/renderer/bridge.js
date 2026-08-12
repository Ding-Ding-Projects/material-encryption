(() => {
  'use strict';
  const api = window.materialEncryption;
  if (!api) return;

  const state = { menu: null, wizard: null, locks: [], skipNextContext: false, unlockedUntil: new Map(), allowNextActivation: new Set() };

  const css = document.createElement('style');
  css.textContent = `
    [data-toy-lock-id].toy-lock-active{outline:2px solid #f2b8b5!important;outline-offset:2px}
    .toy-layer{position:fixed;z-index:100000;color:#e3e3e3;font:400 14px/20px Arial,sans-serif}
    .toy-card{background:#282a2c;border:1px solid #8e918f;border-radius:18px;box-shadow:0 16px 48px #000c;padding:14px}
    .toy-menu{width:min(330px,calc(100vw - 24px));max-height:min(560px,calc(100vh - 24px));overflow:auto}
    .toy-row{display:flex;gap:8px;align-items:center}.toy-grid{display:grid;gap:12px}
    .toy-input,.toy-select{width:100%;min-height:44px;background:#1e1f20;border:1px solid #8e918f;border-radius:12px;color:#e3e3e3;padding:10px 12px}
    .toy-button{min-height:44px;border:0;border-radius:22px;padding:9px 16px;background:#a8c7fa;color:#062e6f;font-weight:600;cursor:pointer}
    .toy-button.secondary{background:transparent;color:#e3e3e3;border:1px solid #8e918f}.toy-button.danger{background:#8c1d18;color:#f9dedc}
    .toy-menu-action{width:100%;display:flex;justify-content:space-between;text-align:left;background:transparent;color:#e3e3e3;border:0;border-radius:10px;min-height:44px;padding:11px 12px;cursor:pointer}
    .toy-menu-action:hover,.toy-menu-action:focus-visible{background:#333537}
    .toy-wizard{width:min(620px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 24px));overflow:auto}
    .toy-eyebrow{color:#a8c7fa;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
    .toy-title{font-size:22px;line-height:28px;margin:4px 0}.toy-copy{color:#c4c7c5;margin:4px 0 12px}
    .toy-error{background:#8c1d18;color:#f9dedc;border-radius:12px;padding:10px}.toy-note{background:#1e1f20;border-radius:12px;padding:12px;color:#c4c7c5}
    .toy-qr{width:220px;height:220px;background:#fff;border-radius:10px}
    @media(max-width:520px){.toy-row.responsive{display:grid}.toy-qr{width:180px;height:180px}}
  `;
  document.head.appendChild(css);

  const notify = (title, body, kind = 'info') => {
    const region = document.getElementById('native-status') || (() => {
      const element = document.createElement('div');
      element.id = 'native-status'; element.setAttribute('role', kind === 'error' ? 'alert' : 'status'); element.setAttribute('aria-live', 'polite');
      Object.assign(element.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: 100001, maxWidth: '420px', padding: '14px 18px', borderRadius: '16px', background: kind === 'error' ? '#8c1d18' : '#333537', color: '#e3e3e3', boxShadow: '0 8px 28px #0008' });
      document.body.appendChild(element); return element;
    })();
    region.textContent = `${title}. ${body}`;
    clearTimeout(region._timer); region._timer = setTimeout(() => region.remove(), kind === 'error' ? 12000 : 5000);
  };

  function fnv(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function elementPath(element) {
    const parts = [];
    let node = element;
    while (node && node !== document.body) {
      let index = 1; let sibling = node;
      while ((sibling = sibling.previousElementSibling)) if (sibling.tagName === node.tagName) index++;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
      node = node.parentElement;
    }
    return parts.join('>');
  }

  function labelFor(element) {
    const candidate = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.textContent || element.tagName;
    return String(candidate).replace(/\s+/g, ' ').trim().slice(0, 180) || element.tagName.toLowerCase();
  }

  function identify(element) {
    if (!(element instanceof Element)) return null;
    if (!element.dataset.toyLockId) element.dataset.toyLockId = `element-${fnv(elementPath(element))}`;
    return { targetId: element.dataset.toyLockId, targetLabel: `${element.tagName.toLowerCase()} · ${labelFor(element)}`, element };
  }

  function decorate() {
    document.body.querySelectorAll('*').forEach((element) => {
      if (!element.closest('.toy-layer')) identify(element);
    });
    for (const lock of state.locks) document.querySelector(`[data-toy-lock-id="${CSS.escape(lock.targetId)}"]`)?.classList.add('toy-lock-active');
  }

  async function refreshLocks() {
    const result = await api.listLocks();
    if (!result.ok) return notify('Lock list unavailable', result.error, 'error');
    state.locks = result.value;
    document.querySelectorAll('.toy-lock-active').forEach((element) => element.classList.remove('toy-lock-active'));
    decorate();
  }

  function lockFor(element) {
    const target = element?.closest?.('[data-toy-lock-id]');
    if (!target) return null;
    const lock = state.locks.find((entry) => entry.targetId === target.dataset.toyLockId);
    return lock ? { lock, element: target } : null;
  }

  function isUnlocked(lock) {
    const expires = state.unlockedUntil.get(lock.id);
    return expires === Infinity || (typeof expires === 'number' && expires > Date.now());
  }

  function unlockForDuration(lock) {
    const duration = lock.duration;
    if (duration === '15m') state.unlockedUntil.set(lock.id, Date.now() + 15 * 60 * 1000);
    else if (duration === '60m') state.unlockedUntil.set(lock.id, Date.now() + 60 * 60 * 1000);
    else if (duration === 'session') state.unlockedUntil.set(lock.id, Infinity);
    else state.allowNextActivation.add(lock.id);
  }

  function position(layer, target, preferred) {
    const rect = target?.getBoundingClientRect();
    const left = Math.max(12, Math.min(preferred?.x ?? rect?.left ?? 12, window.innerWidth - layer.offsetWidth - 12));
    const below = rect ? rect.bottom + 8 : (preferred?.y ?? 12);
    const top = Math.max(12, Math.min(below, window.innerHeight - layer.offsetHeight - 12));
    layer.style.left = `${left}px`; layer.style.top = `${top}px`;
  }

  function closeLayers() {
    document.querySelectorAll('.toy-layer').forEach((element) => element.remove());
    state.menu = null; state.wizard = null;
  }

  function createLayer(kind, target) {
    closeLayers();
    const layer = document.createElement('div'); layer.className = `toy-layer ${kind}`; layer.dataset.toyUi = 'true';
    layer.addEventListener('contextmenu', (event) => event.stopPropagation());
    document.body.appendChild(layer); requestAnimationFrame(() => position(layer, target)); return layer;
  }

  function openElementMenu(target, point) {
    const info = identify(target); if (!info) return;
    const existing = state.locks.find((lock) => lock.targetId === info.targetId);
    const layer = createLayer('toy-menu-layer', target); layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-label', `Element actions for ${info.targetLabel}`);
    layer.innerHTML = `<div class="toy-card toy-menu"><div class="toy-eyebrow">Element actions</div><div class="toy-title"></div><div class="toy-row"><input class="toy-input" aria-label="Filter element actions" placeholder="Filter actions"><button class="toy-button secondary regex">.*</button></div><div class="regex-options" hidden><label><input type="checkbox" class="regex-mode"> Use regular expression</label><input class="toy-input regex-pattern" aria-label="Regular expression" placeholder="^Lock"><input class="toy-input regex-flags" aria-label="Regular expression flags" value="i"></div><div class="actions"></div><div class="empty toy-note" hidden>No matching actions.</div></div>`;
    layer.querySelector('.toy-title').textContent = info.targetLabel;
    const definitions = [
      { label: existing ? (isUnlocked(existing) ? 'Lock this element again' : 'Unlock or remove this element lock…') : 'Lock this element…', run: () => existing ? (isUnlocked(existing) ? relock(info, existing) : openUnlockWizard(info, existing)) : openLockWizard(info) },
      { label: 'Edit this element appearance…', run: () => window.dispatchEvent(new CustomEvent('material-encryption-appearance-target', { detail: info })) },
      { label: 'Open original element actions…', run: () => { closeLayers(); state.skipNextContext = true; target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y })); } }
    ];
    const actions = layer.querySelector('.actions');
    const render = () => {
      const useRegex = layer.querySelector('.regex-mode').checked; const query = layer.querySelector('.toy-input').value; const pattern = layer.querySelector('.regex-pattern').value; const flags = layer.querySelector('.regex-flags').value;
      let predicate;
      try { const regex = useRegex ? new RegExp(pattern, flags.replace(/g/g, '')) : null; predicate = (item) => useRegex ? regex.test(item.label) : item.label.toLowerCase().includes(query.toLowerCase()); layer.querySelector('.regex-pattern').setCustomValidity(''); }
      catch (error) { layer.querySelector('.regex-pattern').setCustomValidity(error.message); predicate = () => false; }
      actions.replaceChildren(); const filtered = definitions.filter(predicate);
      for (const item of filtered) { const button = document.createElement('button'); button.className = 'toy-menu-action'; button.textContent = item.label; button.addEventListener('click', item.run); actions.appendChild(button); }
      layer.querySelector('.empty').hidden = filtered.length !== 0;
    };
    layer.querySelector('.regex').addEventListener('click', () => { const panel = layer.querySelector('.regex-options'); panel.hidden = !panel.hidden; if (!panel.hidden) layer.querySelector('.regex-pattern').focus(); });
    layer.querySelectorAll('input').forEach((input) => input.addEventListener('input', render)); render();
    requestAnimationFrame(() => { position(layer, target, point); layer.querySelector('.toy-input').focus(); });
  }

  function relock(info, lock) {
    state.unlockedUntil.delete(lock.id); state.allowNextActivation.delete(lock.id); closeLayers();
    notify('Element locked again', info.targetLabel); info.element.focus?.();
  }

  function openElementNavigator() {
    decorate();
    const elements = [...document.querySelectorAll('[data-toy-lock-id]')].filter((element) => !element.closest('.toy-layer'));
    const layer = createLayer('toy-menu-layer', document.activeElement); layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-label', 'Choose an element to lock');
    layer.innerHTML = '<div class="toy-card toy-menu"><div class="toy-eyebrow">Keyboard element navigator</div><div class="toy-title">Choose an exact rendered element</div><div class="toy-row"><input class="toy-input query" aria-label="Filter rendered elements" placeholder="Filter elements"><button class="toy-button secondary regex">.*</button></div><div class="regex-options" hidden><label><input type="checkbox" class="regex-mode"> Use regular expression</label><input class="toy-input regex-pattern" aria-label="Element regular expression" placeholder="^button"><input class="toy-input regex-flags" aria-label="Element regular expression flags" value="i"></div><div class="actions"></div><div class="empty toy-note" hidden>No matching elements.</div></div>';
    const render = () => {
      const query = layer.querySelector('.query').value; const useRegex = layer.querySelector('.regex-mode').checked;
      let predicate;
      try { const regex = useRegex ? new RegExp(layer.querySelector('.regex-pattern').value, layer.querySelector('.regex-flags').value.replace(/g/g, '')) : null; predicate = (item) => { const label = item.targetLabel || item.label || ''; return useRegex ? regex.test(label) : label.toLowerCase().includes(query.toLowerCase()); }; layer.querySelector('.regex-pattern').setCustomValidity(''); }
      catch (error) { layer.querySelector('.regex-pattern').setCustomValidity(error.message); predicate = () => false; }
      const matches = elements.map(identify).filter(predicate).slice(0, 250); const actions = layer.querySelector('.actions'); actions.replaceChildren();
      for (const info of matches) { const button = document.createElement('button'); button.className = 'toy-menu-action'; button.textContent = info.targetLabel; button.addEventListener('click', () => openElementMenu(info.element, { x: 24, y: 24 })); actions.appendChild(button); }
      layer.querySelector('.empty').hidden = matches.length !== 0;
    };
    layer.querySelector('.regex').addEventListener('click', () => { const options = layer.querySelector('.regex-options'); options.hidden = !options.hidden; });
    layer.querySelectorAll('input').forEach((input) => input.addEventListener('input', render)); render();
    requestAnimationFrame(() => { position(layer, document.activeElement, { x: 24, y: 24 }); layer.querySelector('.query').focus(); });
  }

  function openLockWizard(info) {
    const wizard = { step: 0, method: 'password', duration: 'surface', credential: '', confirm: '', enrollment: null, code: '' };
    state.wizard = wizard;
    const layer = createLayer('toy-wizard-layer', info.element); layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'false'); layer.setAttribute('aria-labelledby', 'toy-wizard-title');
    const render = async () => {
      layer.innerHTML = `<div class="toy-card toy-wizard"><div class="toy-eyebrow">Lock wizard · step ${wizard.step + 1} of 4</div><h2 class="toy-title" id="toy-wizard-title"></h2><p class="toy-copy"></p><div class="content toy-grid"></div><div class="error toy-error" hidden></div><div class="toy-row" style="margin-top:16px"><button class="toy-button secondary back">Back</button><span style="flex:1"></span><button class="toy-button secondary cancel">Cancel</button><button class="toy-button next">${wizard.step === 3 ? 'Create lock' : 'Next'}</button></div></div>`;
      layer.querySelector('#toy-wizard-title').textContent = info.targetLabel;
      const copy = ['This wizard is bound to this exact element and no other target.', 'Choose this element lock’s independent credential method.', 'Set and confirm the credential for this element only.', 'Choose the unlock duration and review recovery. This is a toy lock, not security or encryption.'][wizard.step];
      layer.querySelector('.toy-copy').textContent = copy;
      const content = layer.querySelector('.content');
      if (wizard.step === 0) content.innerHTML = '<div class="toy-note">Scope: this exact rendered element. Shared wizard code does not share target state or credentials.</div>';
      if (wizard.step === 1) content.innerHTML = `<label><input type="radio" name="method" value="password" ${wizard.method === 'password' ? 'checked' : ''}> Password, independently hashed and encrypted</label><label><input type="radio" name="method" value="otp" ${wizard.method === 'otp' ? 'checked' : ''}> TOTP, independently generated and encrypted</label>`;
      if (wizard.step === 2 && wizard.method === 'password') content.innerHTML = '<label>Password for this element only<input class="toy-input credential" type="password" autocomplete="new-password"></label><label>Confirm password<input class="toy-input confirm" type="password" autocomplete="new-password"></label>';
      if (wizard.step === 2 && wizard.method === 'otp') {
        if (!wizard.enrollment) { const result = await api.beginOtp({ targetId: info.targetId, targetLabel: info.targetLabel }); if (!result.ok) return showError(layer, result.error); wizard.enrollment = result.value; }
        content.innerHTML = '<div class="toy-row responsive"><img class="toy-qr" alt="QR code to pair the independent TOTP lock for this element"><div class="toy-grid"><div>Manual secret</div><code class="secret"></code><div>SHA-1 · 6 digits · 30 seconds</div><label>Type one current code<input class="toy-input code" inputmode="numeric" maxlength="6"></label></div></div>';
        content.querySelector('.toy-qr').src = wizard.enrollment.qrDataUrl; content.querySelector('.secret').textContent = wizard.enrollment.manualSecret;
      }
      if (wizard.step === 3) content.innerHTML = `<label>Unlock duration<select class="toy-select duration"><option value="surface">This surface only</option><option value="15m">15 minutes</option><option value="60m">60 minutes</option><option value="session">Until app closes</option></select></label><div class="toy-note">Nothing is sent anywhere. Nobody is reading it. Delete the application-data folder to reset all toy locks.</div>`;
      layer.querySelectorAll('input[name=method]').forEach((radio) => radio.addEventListener('change', (event) => { wizard.method = event.target.value; wizard.enrollment = null; }));
      layer.querySelector('.back').disabled = wizard.step === 0;
      layer.querySelector('.back').addEventListener('click', () => { wizard.step--; render(); });
      layer.querySelector('.cancel').addEventListener('click', () => { closeLayers(); info.element.focus?.(); });
      layer.querySelector('.next').addEventListener('click', async () => {
        if (wizard.step === 2 && wizard.method === 'password') { wizard.credential = layer.querySelector('.credential').value; wizard.confirm = layer.querySelector('.confirm').value; if (!wizard.credential || wizard.credential !== wizard.confirm) return showError(layer, 'The two password entries must match.'); }
        if (wizard.step === 2 && wizard.method === 'otp') { wizard.code = layer.querySelector('.code').value; if (!/^\d{6}$/.test(wizard.code)) return showError(layer, 'Type one current six-digit code.'); }
        if (wizard.step === 3) {
          wizard.duration = layer.querySelector('.duration').value;
          const result = await api.createLock({ targetId: info.targetId, targetLabel: info.targetLabel, method: wizard.method, duration: wizard.duration, credential: wizard.method === 'password' ? wizard.credential : wizard.code, enrollmentId: wizard.enrollment?.enrollmentId });
          if (!result.ok) return showError(layer, result.error);
          closeLayers(); await refreshLocks(); notify('Element lock created', `${info.targetLabel}. This is a toy lock, not encryption.`); info.element.focus?.(); return;
        }
        wizard.step++; await render();
      });
      requestAnimationFrame(() => position(layer, info.element));
    };
    render();
  }

  function openUnlockWizard(info, lock) {
    const layer = createLayer('toy-wizard-layer', info.element); layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'false');
    layer.innerHTML = `<div class="toy-card toy-wizard toy-grid"><div class="toy-eyebrow">Toy lock</div><h2 class="toy-title"></h2><p class="toy-copy">This is not encryption or a security boundary. Delete the application-data folder to reset it.</p><label>${lock.method === 'otp' ? 'Current TOTP code' : 'Password'}<input class="toy-input credential" type="password"></label><div class="error toy-error" hidden></div><div class="toy-row"><button class="toy-button secondary cancel">Cancel</button><span style="flex:1"></span><button class="toy-button unlock">Unlock</button><button class="toy-button danger remove">Remove lock</button></div></div>`;
    layer.querySelector('.toy-title').textContent = info.targetLabel;
    const submit = async (remove) => { const result = await (remove ? api.removeLock : api.verifyLock)({ lockId: lock.id, credential: layer.querySelector('.credential').value }); if (!result.ok) return showError(layer, result.error); if (remove) await refreshLocks(); else unlockForDuration(lock); closeLayers(); notify(remove ? 'Element lock removed' : 'Element unlocked', info.targetLabel); info.element.focus?.(); };
    layer.querySelector('.cancel').addEventListener('click', closeLayers); layer.querySelector('.unlock').addEventListener('click', () => submit(false)); layer.querySelector('.remove').addEventListener('click', () => submit(true));
    requestAnimationFrame(() => { position(layer, info.element); layer.querySelector('.credential').focus(); });
  }

  function showError(layer, message) { const error = layer.querySelector('.error'); if (error) { error.textContent = message; error.hidden = false; } else notify('Operation failed', message, 'error'); }

  document.addEventListener('contextmenu', (event) => {
    if (state.skipNextContext) { state.skipNextContext = false; return; }
    if (event.target.closest('.toy-layer')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    openElementMenu(event.target, { x: event.clientX, y: event.clientY });
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target.closest('.toy-layer')) return;
    const found = lockFor(event.target); if (!found) return;
    if (state.allowNextActivation.delete(found.lock.id) || isUnlocked(found.lock)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    openUnlockWizard(identify(found.element), found.lock);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.querySelector('.toy-layer')) { event.preventDefault(); closeLayers(); return; }
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); openElementNavigator(); return; }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openElementMenu(document.activeElement === document.body ? document.querySelector('main') : document.activeElement, { x: 24, y: 24 }); }
  });

  window.addEventListener('material-encryption-lock-target', (event) => {
    const element = document.querySelector(`[data-toy-lock-id="${CSS.escape(event.detail.targetId)}"]`) || document.querySelector('main');
    openLockWizard({ targetId: event.detail.targetId, targetLabel: event.detail.targetLabel, element });
  });

  window.addEventListener('material-encryption-element-menu', (event) => {
    const targetId = typeof event.detail?.targetId === 'string' ? event.detail.targetId : '';
    const element = targetId ? document.querySelector(`[data-toy-lock-id="${CSS.escape(targetId)}"]`) : null;
    openElementMenu(element || document.querySelector('main'), { x: 24, y: 24 });
  });

  new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });
  decorate(); refreshLocks();
  // Container work — creating, opening, re-keying, header backup and restore —
  // is performed by this app's own engine and needs nothing installed. Only
  // assigning a drive letter needs the VeraCrypt kernel driver, because Windows
  // will not load an unsigned filesystem driver.
  api.getStatus().then((result) => {
    if (!result.ok) { notify('Volume status unavailable', result.error, 'error'); return; }
    const status = result.value;
    document.documentElement.dataset.veracrypt = status.installed ? 'ready' : 'engine-only';
    document.documentElement.dataset.elevated = status.elevated ? 'yes' : 'no';
    if (!status.installed) {
      notify('Mounting to a drive letter is unavailable', 'Creating, opening, re-keying and repairing containers all work without it. Assigning a drive letter needs the VeraCrypt kernel driver, which Windows only loads when signed.', 'warning');
    } else if (!status.elevated) {
      notify('Running without administrator rights', 'Containers work normally. Mounting and unmounting drive letters will be refused by the driver until the app is restarted elevated.', 'warning');
    }
  });
})();

// 提示条。页面内实现，不用浏览器原生 alert。

const host = () => document.getElementById('toast-host');

/** 显示一条几秒后自动消失的提示。 */
export function showToast(text, ms = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  host().append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

/** 显示一条不会自动消失、可点击的提示。同一个 id 只显示一条。 */
export function showActionToast(id, text, onClick) {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const el = document.createElement('button');
  el.id = id;
  el.type = 'button';
  el.className = 'toast';
  el.textContent = text;
  el.addEventListener('click', onClick);
  host().append(el);
  return el;
}

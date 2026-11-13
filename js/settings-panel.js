// 设置面板：阅读模式、字号、行距、页边距、主题。改了立即生效。
import { getSettings, updateSetting, stepSetting, LIMITS } from './settings.js';

const $ = (id) => document.getElementById(id);

let onChanged = () => {};

const format = {
  fontSize: (v) => String(v),
  lineHeight: (v) => v.toFixed(1),
  margin: (v) => String(v),
};

/** 让面板上的数字、选中状态、按钮可用状态和当前设置一致。 */
function refresh() {
  const settings = getSettings();
  const panel = $('settings-panel');
  for (const btn of panel.querySelectorAll('button[data-set]')) {
    const selected = settings[btn.dataset.set] === btn.dataset.value;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', String(selected));
  }
  for (const key of Object.keys(LIMITS)) {
    $(`setting-${key}`).textContent = format[key](settings[key]);
  }
  for (const btn of panel.querySelectorAll('button[data-step]')) {
    const { min, max } = LIMITS[btn.dataset.step];
    const value = settings[btn.dataset.step];
    btn.disabled = Number(btn.dataset.dir) < 0 ? value <= min : value >= max;
  }
}

async function onClick(event) {
  const btn = event.target.closest('button');
  if (!btn) return;
  let key = null;
  let changed = false;
  if (btn.dataset.set) {
    key = btn.dataset.set;
    changed = await updateSetting(key, btn.dataset.value);
  } else if (btn.dataset.step) {
    key = btn.dataset.step;
    changed = await stepSetting(key, Number(btn.dataset.dir));
  }
  refresh();
  if (changed) await onChanged(key);
}

/** 只需调用一次。onChange(key) 在某项设置真的变了之后调用。 */
export function setupSettingsPanel({ onChange }) {
  onChanged = onChange;
  $('settings-panel').addEventListener('click', onClick);
}

export function openSettingsPanel() {
  refresh();
  $('settings-panel').hidden = false;
}

export function closeSettingsPanel() {
  $('settings-panel').hidden = true;
}

export function isSettingsPanelOpen() {
  return !$('settings-panel').hidden;
}

// 页面内的弹层。不用浏览器原生的 alert / confirm。

function open({ title, lines = [], buttons, vertical = false, overLock = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    // 从锁屏页弹出的框要盖在锁屏页上面，并且上锁期间不被隐藏（见 base.css）。
    if (overLock) backdrop.classList.add('over-lock');

    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);

    const heading = document.createElement('h2');
    heading.textContent = title;
    box.append(heading);

    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line;
      box.append(p);
    }

    const row = document.createElement('div');
    row.className = vertical ? 'dialog-buttons vertical' : 'dialog-buttons';
    for (const { label, value, kind } of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (kind) btn.dataset.kind = kind;
      btn.addEventListener('click', () => {
        backdrop.remove();
        resolve(value);
      });
      row.append(btn);
    }
    box.append(row);
    backdrop.append(box);
    document.body.append(backdrop);
  });
}

/** 确认框。点确认返回 true，点取消返回 false。danger 为真时确认按钮用强调色。 */
export function confirmDialog({ title, lines, okText = '确定', cancelText = '取消', danger = false, overLock = false }) {
  return open({
    title,
    lines,
    overLock,
    buttons: [
      { label: cancelText, value: false },
      { label: okText, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
}

/**
 * 从几个选项里选一个，选项竖着排。返回所选项的 value；点「取消」返回 null。
 * @param {{ title: string, lines?: string[], choices: { label: string, value: any, kind?: string }[] }} options
 */
export function choiceDialog({ title, lines, choices }) {
  return open({
    title,
    lines,
    vertical: true,
    buttons: [...choices, { label: '取消', value: null }],
  });
}

/** 只有一个「知道了」按钮的信息框。 */
export function infoDialog({ title, lines, overLock = false }) {
  return open({ title, lines, overLock, buttons: [{ label: '知道了', value: true, kind: 'primary' }] });
}

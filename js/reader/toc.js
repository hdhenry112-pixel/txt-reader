// 目录面板：列出所有章，高亮当前章，点击跳到该章开头。

const $ = (id) => document.getElementById(id);

let onPick = () => {};

/** 只需调用一次。 */
export function setupToc() {
  $('toc-close').addEventListener('click', closeToc);
  // 所有目录项共用一个点击处理，几千章的书也只有一个监听器。
  $('toc-list').addEventListener('click', (event) => {
    const item = event.target.closest('button[data-idx]');
    if (!item) return;
    closeToc();
    onPick(Number(item.dataset.idx));
  });
}

/**
 * @param {{ title: string }[]} entries 目录
 * @param {number} currentIdx 当前章
 * @param {(idx: number) => void} pick 用户点了某一章
 */
export function openToc(entries, currentIdx, pick) {
  onPick = pick;
  const items = entries.map((entry, idx) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.idx = String(idx);
    btn.textContent = entry.title;
    if (idx === currentIdx) {
      btn.classList.add('current');
      btn.setAttribute('aria-current', 'true');
    }
    li.append(btn);
    return li;
  });
  $('toc-list').replaceChildren(...items);
  $('toc-panel').hidden = false;
  // 让当前章出现在列表中间。
  items[currentIdx]?.scrollIntoView({ block: 'center' });
}

export function closeToc() {
  $('toc-panel').hidden = true;
  $('toc-list').replaceChildren();
}

export function isTocOpen() {
  return !$('toc-panel').hidden;
}

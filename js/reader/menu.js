// 阅读页的菜单：顶部栏（返回书架、书名）和底部栏（目录、当前章名、全书进度、设置）。

const $ = (id) => document.getElementById(id);

export function isMenuVisible() {
  return !$('reader-top').hidden;
}

export function setMenuVisible(visible) {
  $('reader-top').hidden = !visible;
  $('reader-bottom').hidden = !visible;
}

export function updateMenu({ bookTitle, chapterTitle, percent }) {
  if (bookTitle !== undefined) $('reader-book-title').textContent = bookTitle;
  if (chapterTitle !== undefined) $('reader-chapter-title').textContent = chapterTitle;
  if (percent !== undefined) $('reader-percent').textContent = `${percent}%`;
}

/** 只需调用一次。 */
export function setupMenu({ onBack, onToc, onSettings }) {
  $('reader-back').addEventListener('click', onBack);
  $('reader-toc-button').addEventListener('click', onToc);
  $('reader-settings-button').addEventListener('click', onSettings);
}

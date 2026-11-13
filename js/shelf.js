// 书架页。M0 只有空状态；导入和书的列表在 M1 加入。

export function renderShelf(books = []) {
  const list = document.getElementById('shelf-list');
  const empty = document.getElementById('shelf-empty');
  list.replaceChildren();
  empty.hidden = books.length > 0;
}

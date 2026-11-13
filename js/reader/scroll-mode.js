// 滚动模式：当前章上下滚动；章首有「上一章」、章末有「下一章」。
import { charRect, firstVisibleOffset, locate } from './position.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.scroller 可滚动的容器
 * @param {HTMLElement} deps.content 放章节内容的元素
 * @param {(delta: number) => void} deps.onNavigate 点了上一章（-1）或下一章（+1）
 * @param {() => void} deps.onTap 点了正文区域
 * @param {() => void} deps.onMove 位置变了（滚动）
 */
export function createScrollMode({ scroller, content, onNavigate, onTap, onMove }) {
  let paras = [];

  const navButton = (label, delta) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chapter-nav';
    btn.textContent = label;
    btn.addEventListener('click', () => onNavigate(delta));
    return btn;
  };

  /** 可见区域的上边缘在屏幕上的位置。 */
  const topEdge = () => scroller.getBoundingClientRect().top;

  function render({ title, paragraphs, hasPrev, hasNext }) {
    const nodes = [];
    if (hasPrev) nodes.push(navButton('上一章', -1));

    const heading = document.createElement('h2');
    heading.className = 'chapter-title';
    heading.textContent = title;
    nodes.push(heading);

    paras = [];
    let start = 0;
    for (const text of paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      p.dataset.start = String(start);
      start += text.length;
      paras.push(p);
      nodes.push(p);
    }

    if (hasNext) {
      nodes.push(navButton('下一章', 1));
    } else {
      const end = document.createElement('div');
      end.className = 'book-end';
      end.textContent = '全书完';
      nodes.push(end);
    }

    content.replaceChildren(...nodes);
    scroller.scrollTop = 0;
  }

  /** 屏幕上第一个可见的字在本章的序号。 */
  function getOffset() {
    if (scroller.scrollTop <= 0 || !paras.length) return 0;
    const top = topEdge();
    // 一个字的下边缘超过可见区域上边缘 1 像素以上，就算可见。
    const offset = firstVisibleOffset(paras, (rect) => rect.bottom > top + 1);
    if (offset !== null) return offset;
    // 所有正文都滚过去了（屏幕上只剩「下一章」按钮）：记为最后一个字。
    const last = paras[paras.length - 1];
    return Number(last.dataset.start) + last.firstChild.length - 1;
  }

  /** 是否已经滚到本章最底部。 */
  function isAtEnd() {
    return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  }

  /** 滚动到让本章第 offset 个字所在的那一行贴着可见区域上边缘。 */
  function restore(offset) {
    if (offset <= 0) {
      scroller.scrollTop = 0;
      return;
    }
    const found = locate(paras, offset);
    if (!found) return;
    scroller.scrollTop += charRect(found.p, found.index).top - topEdge();
  }

  function scrollToEnd() {
    scroller.scrollTop = scroller.scrollHeight;
  }

  const onScroll = () => onMove();
  const onClick = (event) => {
    // 点按钮不算点正文。
    if (event.target.closest('button')) return;
    onTap();
  };

  function activate() {
    scroller.addEventListener('scroll', onScroll, { passive: true });
    content.addEventListener('click', onClick);
  }

  function deactivate() {
    scroller.removeEventListener('scroll', onScroll);
    content.removeEventListener('click', onClick);
    content.replaceChildren();
    paras = [];
  }

  return { render, getOffset, isAtEnd, restore, scrollToEnd, activate, deactivate };
}

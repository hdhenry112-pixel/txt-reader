// 翻页模式：用 CSS columns 把当前章排成横向的多页，每次平移一个屏幕宽度。
// 点左 1/3 上一页、右 1/3 下一页、中间 1/3 菜单；左右滑动也能翻页。
import { charRect, firstVisibleOffset, locate } from './position.js';

/** 每页上下留白（像素）。 */
const V_PAD = 16;
/** 手指横向移动超过这个距离才算滑动（像素）。 */
const SWIPE_MIN = 40;
/** 翻页过渡的时长（毫秒）。 */
const TURN_MS = 200;

/**
 * @param {object} deps
 * @param {HTMLElement} deps.scroller 可见区域（一页的大小）
 * @param {HTMLElement} deps.content 放章节内容的元素
 * @param {() => number} deps.getMargin 当前的页边距（像素）
 * @param {(delta: number, fromEnd: boolean) => void} deps.onNavigate 翻过了章首（-1）或章末（+1）
 * @param {(zone: 'prev' | 'menu' | 'next') => void} deps.onTap 点了屏幕的哪个区域
 * @param {() => void} deps.onMove 位置变了（翻了一页）
 */
export function createPageMode({ scroller, content, getMargin, onNavigate, onTap, onMove }) {
  let paras = [];
  let page = 0;
  let pages = 1;
  let width = 0;
  let pressed = null;        // 手指按下时的位置
  let swallowClick = false;  // 滑动结束后浏览器还会补一个 click，要吞掉

  /** 按当前的屏幕宽度和页边距重新分页。不改变当前页码，调用方随后要重新定位。 */
  function layout() {
    width = scroller.clientWidth;
    const margin = getMargin();
    Object.assign(content.style, {
      boxSizing: 'border-box',
      height: '100%',
      padding: `${V_PAD}px ${margin}px`,
      // 每一栏正好是「屏幕宽度减两边页边距」，栏间距是两倍页边距，
      // 这样第 k 栏的左边缘正好在 k × 屏幕宽度 + 页边距 的位置。
      columnWidth: `${width - margin * 2}px`,
      columnGap: `${margin * 2}px`,
      columnFill: 'auto',
    });
    // 页数 = 最后一个元素的右边缘落在第几栏。
    const last = content.lastElementChild;
    let right = 0;
    if (last) {
      const origin = content.getBoundingClientRect().left;
      for (const rect of last.getClientRects()) right = Math.max(right, rect.right - origin);
    }
    pages = Math.max(1, Math.ceil((right - 1) / width));
  }

  function goTo(target, animate) {
    page = Math.min(Math.max(target, 0), pages - 1);
    content.style.transition = animate ? `transform ${TURN_MS}ms ease-out` : 'none';
    content.style.transform = `translate3d(${-page * width}px, 0, 0)`;
    // 给测试和排查问题用：当前页码和总页数。
    content.dataset.page = String(page);
    content.dataset.pages = String(pages);
  }

  function render({ title, paragraphs }) {
    const heading = document.createElement('h2');
    heading.className = 'chapter-title';
    heading.textContent = title;
    const nodes = [heading];

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
    content.replaceChildren(...nodes);
    layout();
    goTo(0, false);
  }

  /**
   * 当前页第一个字在本章的序号。
   * 用「字相对于内容左边缘的位置」判断，不用屏幕坐标：翻页动画进行中屏幕坐标是变化的，相对位置不变。
   */
  function getOffset() {
    if (page === 0 || !paras.length) return 0;
    const origin = content.getBoundingClientRect().left;
    const edge = page * width;
    const offset = firstVisibleOffset(paras, (rect) => rect.right - origin > edge + 1);
    if (offset !== null) return offset;
    const last = paras[paras.length - 1];
    return Number(last.dataset.start) + last.firstChild.length - 1;
  }

  function isAtEnd() {
    return page >= pages - 1;
  }

  /** 翻到包含本章第 offset 个字的那一页。 */
  function restore(offset) {
    if (offset <= 0) {
      goTo(0, false);
      return;
    }
    const found = locate(paras, offset);
    if (!found) return;
    const origin = content.getBoundingClientRect().left;
    const left = charRect(found.p, found.index).left - origin;
    goTo(Math.floor((left + 0.5) / width), false);
  }

  function scrollToEnd() {
    goTo(pages - 1, false);
  }

  /** 设置（字号、行距、页边距）或屏幕尺寸变了之后调用，然后调用方用 restore 重新定位。 */
  function relayout() {
    layout();
    goTo(page, false);
  }

  /** 翻一页。到了章首或章末就交给调用方去换章。 */
  function turn(delta) {
    const target = page + delta;
    if (target < 0) {
      onNavigate(-1, true);
    } else if (target >= pages) {
      onNavigate(1, false);
    } else {
      goTo(target, true);
      onMove();
    }
  }

  const onPointerDown = (event) => {
    pressed = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event) => {
    if (!pressed) return;
    const dx = event.clientX - pressed.x;
    const dy = event.clientY - pressed.y;
    pressed = null;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 400);
      turn(dx < 0 ? 1 : -1); // 向左滑是下一页
    }
  };

  const onPointerCancel = () => {
    pressed = null;
  };

  const onClick = (event) => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    const box = scroller.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    onTap(ratio < 1 / 3 ? 'prev' : ratio > 2 / 3 ? 'next' : 'menu');
  };

  function activate() {
    scroller.scrollTop = 0;
    scroller.addEventListener('pointerdown', onPointerDown);
    scroller.addEventListener('pointerup', onPointerUp);
    scroller.addEventListener('pointercancel', onPointerCancel);
    scroller.addEventListener('click', onClick);
  }

  function deactivate() {
    scroller.removeEventListener('pointerdown', onPointerDown);
    scroller.removeEventListener('pointerup', onPointerUp);
    scroller.removeEventListener('pointercancel', onPointerCancel);
    scroller.removeEventListener('click', onClick);
    content.replaceChildren();
    content.removeAttribute('style');
    delete content.dataset.page;
    delete content.dataset.pages;
    paras = [];
  }

  return { render, getOffset, isAtEnd, restore, scrollToEnd, relayout, turn, activate, deactivate };
}

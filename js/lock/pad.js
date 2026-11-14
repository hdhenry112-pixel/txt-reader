// 九宫格画板：按下并拖过各点，松手提交。
import { addPoint } from './rules.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 手指离点的中心多近算碰到（占一格宽度的比例）。 */
const HIT_RATIO = 0.32;

/**
 * 在 host 里画出九宫格。onComplete(seq) 在松手时调用（seq 是点的编号数组，可能为空不调用）。
 * 返回 { reset, setDisabled, markError }。
 */
export function createPad(host, { onComplete }) {
  host.textContent = '';
  const pad = document.createElement('div');
  pad.className = 'pattern-pad';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pattern-lines');
  svg.setAttribute('viewBox', '0 0 300 300');
  const line = document.createElementNS(SVG_NS, 'polyline');
  svg.append(line);
  pad.append(svg);

  const dots = [];
  for (let i = 0; i < 9; i++) {
    const dot = document.createElement('div');
    dot.className = 'pattern-dot';
    dot.dataset.dot = String(i);
    dot.style.left = `${((i % 3) * 2 + 1) / 6 * 100}%`;
    dot.style.top = `${(Math.floor(i / 3) * 2 + 1) / 6 * 100}%`;
    pad.append(dot);
    dots.push(dot);
  }
  host.append(pad);

  let seq = [];
  let drawing = false;
  let disabled = false;
  let finger = null; // 手指当前位置（viewBox 坐标），画线用

  const center = (i) => [((i % 3) * 2 + 1) * 50, (Math.floor(i / 3) * 2 + 1) * 50];

  function paint() {
    dots.forEach((dot, i) => dot.classList.toggle('on', seq.includes(i)));
    const points = seq.map(center);
    if (drawing && finger && points.length) points.push(finger);
    line.setAttribute('points', points.map((p) => p.join(',')).join(' '));
  }

  function toPadCoords(event) {
    const box = pad.getBoundingClientRect();
    return [(event.clientX - box.left) / box.width * 300, (event.clientY - box.top) / box.height * 300];
  }

  function track(event) {
    finger = toPadCoords(event);
    const [x, y] = finger;
    for (let i = 0; i < 9; i++) {
      const [cx, cy] = center(i);
      if (Math.hypot(x - cx, y - cy) <= 100 * HIT_RATIO) seq = addPoint(seq, i);
    }
    paint();
  }

  pad.addEventListener('pointerdown', (event) => {
    if (disabled) return;
    event.preventDefault();
    pad.setPointerCapture?.(event.pointerId);
    pad.classList.remove('error');
    seq = [];
    drawing = true;
    track(event);
  });
  pad.addEventListener('pointermove', (event) => {
    if (drawing) track(event);
  });
  const finish = (submit) => {
    if (!drawing) return;
    drawing = false;
    finger = null;
    paint();
    if (submit && seq.length) onComplete([...seq]);
  };
  pad.addEventListener('pointerup', () => finish(true));
  pad.addEventListener('pointercancel', () => finish(false));

  return {
    reset() {
      seq = [];
      drawing = false;
      pad.classList.remove('error');
      paint();
    },
    setDisabled(value) {
      disabled = value;
      pad.classList.toggle('disabled', value);
    },
    /** 把刚画的图案标红（画错时用），下次按下时清掉。 */
    markError() {
      pad.classList.add('error');
    },
  };
}

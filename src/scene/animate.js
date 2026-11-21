export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInQuad = (t) => t * t;

/**
 * 极简补间动画系统
 */
export class Animator {
  constructor() {
    this.items = [];
    // 全局时间缩放：0 = 顿帧（所有补间冻结），0.45 = 慢镜
    this.timeScale = 1;
  }

  add({ duration = 300, delay = 0, easing = easeOutCubic, onUpdate = () => {}, onComplete = null }) {
    return new Promise((resolve) => {
      this.items.push({ duration, delay, elapsed: 0, easing, onUpdate, onComplete, resolve });
    });
  }

  update(dt) {
    const done = [];
    const step = dt * this.timeScale;
    for (const item of this.items) {
      item.elapsed += step;
      if (item.elapsed < item.delay) continue;
      const t = Math.min(1, (item.elapsed - item.delay) / Math.max(1, item.duration));
      item.onUpdate(item.easing(t), t);
      if (t >= 1) {
        done.push(item);
        if (item.onComplete) item.onComplete();
        item.resolve();
      }
    }
    if (done.length) this.items = this.items.filter((i) => !done.includes(i));
  }

  get busy() {
    return this.items.length > 0;
  }

  clear() {
    for (const item of this.items) item.resolve();
    this.items = [];
  }
}

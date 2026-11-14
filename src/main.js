import { Game } from './game.js';

const canvas = document.getElementById('scene');
const loading = document.getElementById('loading');

try {
  const game = new Game(canvas);
  game.start();
} catch (err) {
  console.error(err);
  if (loading) {
    loading.innerHTML = `
      <div class="loading-mark">♞</div>
      <span style="letter-spacing:.12em;text-align:center;line-height:1.9;padding:0 24px">
        无法初始化 3D 场景<br />
        <small style="opacity:.6">请确认浏览器已启用 WebGL</small>
      </span>`;
  }
}

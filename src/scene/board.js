import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const BOARD_TOP = 0.1;
export const SQUARE_SIZE = 1;

/* ------------------------- 程序化贴图 ------------------------- */

function makeMarbleTexture(size = 512, seed = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0ece4';
  ctx.fillRect(0, 0, size, size);

  let rnd = seed;
  const rand = () => {
    rnd = (rnd * 16807) % 2147483647;
    return rnd / 2147483647;
  };

  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    const y = rand() * size;
    ctx.moveTo(-20, y);
    for (let x = 0; x <= size + 20; x += size / 8) {
      ctx.lineTo(x, y + (rand() - 0.5) * size * 0.16);
    }
    ctx.strokeStyle = `rgba(120, 105, 88, ${0.03 + rand() * 0.07})`;
    ctx.lineWidth = 1 + rand() * 5;
    ctx.stroke();
  }
  // 细颗粒
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 9;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeWoodTexture(size = 512, seed = 7) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8b6a4b';
  ctx.fillRect(0, 0, size, size);

  let rnd = seed;
  const rand = () => {
    rnd = (rnd * 48271) % 2147483647;
    return rnd / 2147483647;
  };

  for (let i = 0; i < 90; i++) {
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += size / 10) {
      ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 4 + rand() * 3) * 4 + (rand() - 0.5) * 3);
    }
    const dark = rand() > 0.5;
    ctx.strokeStyle = dark
      ? `rgba(48, 30, 17, ${0.05 + rand() * 0.16})`
      : `rgba(226, 190, 148, ${0.03 + rand() * 0.1})`;
    ctx.lineWidth = 0.6 + rand() * 3.2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 8;
  return tex;
}

function makeLabelTexture(text) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(226, 195, 128, 0.92)';
  ctx.font = '600 74px "Georgia", "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------- 迷雾贴图 ------------------------- */

/** 格子上的冷灰雾：中心浓、边缘柔，带一点随机絮状纹理 */
function makeFogTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(16, 20, 29, 0.94)');
  grad.addColorStop(0.55, 'rgba(18, 23, 33, 0.92)');
  grad.addColorStop(0.86, 'rgba(21, 27, 38, 0.86)');
  grad.addColorStop(1, 'rgba(24, 30, 42, 0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 絮状纹理，避免大面积死黑
  let rnd = 1337;
  const rand = () => {
    rnd = (rnd * 16807) % 2147483647;
    return rnd / 2147483647;
  };
  for (let i = 0; i < 46; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.05 + rand() * 0.16);
    const light = rand() > 0.5;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, light ? 'rgba(96, 112, 140, 0.10)' : 'rgba(8, 10, 16, 0.12)');
    blob.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------- 棋盘 ------------------------- */

export function squareToWorld(sq) {
  const file = sq & 7;
  const row = sq >> 3;
  return new THREE.Vector3(file - 3.5, BOARD_TOP, row - 3.5);
}

export function worldToSquare(point) {
  const file = Math.floor(point.x + 4);
  const row = Math.floor(point.z + 4);
  if (file < 0 || file > 7 || row < 0 || row > 7) return -1;
  return row * 8 + file;
}

const HIGHLIGHT_Y = BOARD_TOP + 0.004;

export function createBoard() {
  const group = new THREE.Group();
  group.name = 'board';

  /* 木质外框 */
  const wood = makeWoodTexture();
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x7a5a3e,
    map: wood,
    roughness: 0.42,
    metalness: 0.02,
    clearcoat: 0.65,
    clearcoatRoughness: 0.28,
  });
  const frame = new THREE.Mesh(new RoundedBoxGeometry(9.5, 0.62, 9.5, 4, 0.16), frameMat);
  frame.position.y = -0.31;
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  /* 内嵌深色衬底 */
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(8.06, 0.1, 8.06),
    new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 0.7, metalness: 0.1 })
  );
  inner.position.y = 0.0;
  inner.receiveShadow = true;
  group.add(inner);

  /* 金色装饰线 */
  const goldMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8a256,
    metalness: 1,
    roughness: 0.32,
  });
  const trimGeoH = new THREE.BoxGeometry(8.9, 0.022, 0.03);
  const trimGeoV = new THREE.BoxGeometry(0.03, 0.022, 8.9);
  for (const z of [-4.56, 4.56]) {
    const m = new THREE.Mesh(trimGeoH, goldMat);
    m.position.set(0, 0.005, z);
    group.add(m);
  }
  for (const x of [-4.56, 4.56]) {
    const m = new THREE.Mesh(trimGeoV, goldMat);
    m.position.set(x, 0.005, 0);
    group.add(m);
  }

  /* 64 个格子 */
  const marbleLight = makeMarbleTexture(512, 11);
  const marbleDark = makeMarbleTexture(512, 23);
  const lightMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6c4a4,
    map: marbleLight,
    roughness: 0.44,
    metalness: 0.02,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
  });
  const darkMat = new THREE.MeshPhysicalMaterial({
    color: 0x55463a,
    map: marbleDark,
    roughness: 0.46,
    metalness: 0.04,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
  });

  const squareGeo = new RoundedBoxGeometry(0.985, 0.1, 0.985, 2, 0.022);
  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const sq = row * 8 + file;
      const isLight = (row + file) % 2 === 0;
      const mesh = new THREE.Mesh(squareGeo, isLight ? lightMat : darkMat);
      mesh.position.set(file - 3.5, 0.05, row - 3.5);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.square = sq;
      group.add(mesh);
      squares[sq] = mesh;
    }
  }

  /* 坐标标注 */
  const labelGeoS = new THREE.PlaneGeometry(0.44, 0.44);
  const addLabel = (text, x, z, rotationZ) => {
    const mat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(text),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(labelGeoS, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotationZ;
    mesh.position.set(x, 0.012, z);
    group.add(mesh);
  };
  for (let i = 0; i < 8; i++) {
    const letter = 'abcdefgh'[i];
    const num = String(8 - i);
    addLabel(letter, i - 3.5, 4.29, 0);
    addLabel(letter, i - 3.5, -4.29, Math.PI);
    addLabel(num, -4.29, i - 3.5, -Math.PI / 2);
    addLabel(num, 4.29, i - 3.5, Math.PI / 2);
  }

  /* 迷雾层（迷雾模式下遮住看不见的格子） */
  const fogGroup = new THREE.Group();
  fogGroup.name = 'fog';
  fogGroup.visible = false;
  group.add(fogGroup);

  const fogTexture = makeFogTexture();
  const fogGeo = new THREE.PlaneGeometry(1.03, 1.03);
  const fogQuads = [];
  for (let sq = 0; sq < 64; sq++) {
    const mat = new THREE.MeshBasicMaterial({
      map: fogTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(fogGeo, mat);
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    const p = squareToWorld(sq);
    mesh.position.set(p.x, BOARD_TOP + 0.0035, p.z);
    mesh.renderOrder = 1;
    mesh.visible = false;
    mesh.userData.target = 0;
    fogGroup.add(mesh);
    fogQuads[sq] = mesh;
  }

  /**
   * 设置迷雾：mask 为长度 64、1 = 可见；传 null 关闭迷雾（全部淡出）
   */
  function setFog(mask) {
    if (mask) fogGroup.visible = true;
    for (let sq = 0; sq < 64; sq++) {
      const hidden = mask ? !mask[sq] : false;
      fogQuads[sq].userData.target = hidden ? 1 : 0;
      if (hidden) fogQuads[sq].visible = true;
    }
  }

  function updateFog(dt) {
    if (!fogGroup.visible) return;
    let any = false;
    for (const quad of fogQuads) {
      const target = quad.userData.target;
      const cur = quad.material.opacity;
      if (Math.abs(cur - target) < 0.005) {
        quad.material.opacity = target;
        quad.visible = target > 0.005;
      } else {
        quad.material.opacity = cur + (target - cur) * Math.min(1, dt * 11);
        quad.visible = true;
      }
      if (quad.visible) any = true;
    }
    if (!any) fogGroup.visible = false;
  }

  /* 高亮层 */
  const highlightGroup = new THREE.Group();
  highlightGroup.name = 'highlights';
  group.add(highlightGroup);

  const dotGeo = new THREE.CircleGeometry(0.115, 28);
  const ringGeo = new THREE.RingGeometry(0.33, 0.42, 44);
  const selectGeo = new THREE.RingGeometry(0.39, 0.47, 48);
  const squareGeoHi = new THREE.PlaneGeometry(0.94, 0.94);
  const checkGeo = new THREE.RingGeometry(0.34, 0.46, 40);

  const dotMat = new THREE.MeshBasicMaterial({
    color: 0x63e0c4, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false,
  });
  const captureMat = new THREE.MeshBasicMaterial({
    color: 0xff7a6b, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
  });
  const selectMat = new THREE.MeshBasicMaterial({
    color: 0xf0c96a, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false,
  });
  const lastMat = new THREE.MeshBasicMaterial({
    color: 0xf0c96a, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false,
  });
  const checkMat = new THREE.MeshBasicMaterial({
    color: 0xff4b3e, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false,
  });

  function clear() {
    while (highlightGroup.children.length) {
      highlightGroup.remove(highlightGroup.children[0]);
    }
  }

  const plane = (geo, mat, sq, y = HIGHLIGHT_Y) => {
    const m = new THREE.Mesh(geo, mat);
    const p = squareToWorld(sq);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, y, p.z);
    m.renderOrder = 2;
    highlightGroup.add(m);
    return m;
  };

  let pulseMesh = null;

  function show({ selected = -1, moves = [], lastMove = null, checkSquare = -1 } = {}) {
    clear();
    pulseMesh = null;
    if (lastMove) {
      plane(squareGeoHi, lastMat, lastMove.from, HIGHLIGHT_Y);
      plane(squareGeoHi, lastMat, lastMove.to, HIGHLIGHT_Y);
    }
    for (const move of moves) {
      if (move.captured) plane(ringGeo, captureMat, move.to);
      else plane(dotGeo, dotMat, move.to);
    }
    if (selected >= 0) plane(selectGeo, selectMat, selected, HIGHLIGHT_Y + 0.001);
    if (checkSquare >= 0) {
      pulseMesh = plane(checkGeo, checkMat, checkSquare, HIGHLIGHT_Y + 0.002);
      pulseMesh.userData.pulse = true;
    }
  }

  function update(time, dt = 1 / 60) {
    updateFog(dt);
    if (pulseMesh) {
      pulseMesh.material.opacity = 0.5 + Math.sin(time * 5) * 0.35;
      const s = 1 + Math.sin(time * 5) * 0.06;
      pulseMesh.scale.setScalar(s);
    }
  }

  return { group, squares, show, update, clear, setFog };
}

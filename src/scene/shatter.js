import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { BOARD_TOP } from './board.js';
import { createPieceMesh } from './pieces.js';

/**
 * 吃子「粉碎」特效。
 *
 * 命中瞬间，被吃的棋子先被挤压，随即炸成十几块有体积的碎石：
 * 碎片沿各自位置向外飞散，带重力、自转和一次落桌弹跳，
 * 同时叠加命中闪光、贴地尘埃、金色火花与镜头震动。
 * 全过程约 0.56 秒，只影响渲染层，不参与任何棋局逻辑。
 *
 * 碎裂形状（凸包）按「棋子类型 + 颜色」缓存，首次捕捉或开局预热时生成，
 * 之后每次吃子直接复用，命中当帧没有额外计算开销。
 */

const DURATION = 560; // 特效总时长（毫秒）
const GRAVITY = -15;
const FLOOR_Y = BOARD_TOP + 0.015;
const SHARD_COUNT = 13;
const HULL_POINT_CAP = 180;

const _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* 贴图                                                               */
/* ------------------------------------------------------------------ */

let flashTexture = null;
let dustTexture = null;

function makeRadialTexture(stops, size = 128) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [stop, color] of stops) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 命中闪光 */
function getFlashTexture() {
  if (flashTexture !== null) return flashTexture;
  flashTexture = makeRadialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.25, 'rgba(255,238,205,0.85)'],
    [0.6, 'rgba(255,205,140,0.25)'],
    [1, 'rgba(255,190,120,0)'],
  ]);
  return flashTexture;
}

/** 贴地尘埃：柔和的光尘，没有硬边 */
function getDustTexture() {
  if (dustTexture !== null) return dustTexture;
  dustTexture = makeRadialTexture(
    [
      [0, 'rgba(255,236,208,0)'],
      [0.4, 'rgba(255,236,208,0.06)'],
      [0.62, 'rgba(255,232,200,0.34)'],
      [0.8, 'rgba(255,228,196,0.1)'],
      [1, 'rgba(255,228,196,0)'],
    ],
    256
  );
  return dustTexture;
}

/* ------------------------------------------------------------------ */
/* 碎裂模板                                                           */
/* ------------------------------------------------------------------ */

/** 把棋子拆成三角形（棋子自身坐标系） */
function collectTriangles(piece) {
  piece.updateWorldMatrix(true, true);
  const toPiece = new THREE.Matrix4().copy(piece.matrixWorld).invert();
  const tris = [];
  const sources = new Map();

  piece.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!material) return;
    if (!sources.has(material.uuid)) sources.set(material.uuid, material);

    const geo = obj.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const index = geo.index;
    const local = new THREE.Matrix4().multiplyMatrices(toPiece, obj.matrixWorld);
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const triCount = index ? index.count / 3 : pos.count / 3;

    for (let tri = 0; tri < triCount; tri++) {
      const i0 = index ? index.getX(tri * 3) : tri * 3;
      const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
      const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
      p0.fromBufferAttribute(pos, i0).applyMatrix4(local);
      p1.fromBufferAttribute(pos, i1).applyMatrix4(local);
      p2.fromBufferAttribute(pos, i2).applyMatrix4(local);
      ab.subVectors(p1, p0);
      ac.subVectors(p2, p0);
      nrm.crossVectors(ab, ac);
      const area = nrm.length() * 0.5;
      if (area < 1e-9) continue;
      nrm.multiplyScalar(1 / (area * 2));
      tris.push({
        v: [p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z],
        n: [nrm.x, nrm.y, nrm.z],
        c: [(p0.x + p1.x + p2.x) / 3, (p0.y + p1.y + p2.y) / 3, (p0.z + p1.z + p2.z) / 3],
        a: area,
        m: material.uuid,
      });
    }
  });

  return { tris, sources };
}

/** 按面积加权撒种子 + 两轮 Lloyd 迭代，得到大小均匀、边缘自然的碎片 */
function clusterTriangles(tris, count) {
  if (!tris.length) return [];
  const totalArea = tris.reduce((sum, t) => sum + t.a, 0);
  const seeds = [];
  let guard = 0;
  while (seeds.length < count && guard++ < count * 40) {
    let r = Math.random() * totalArea;
    for (const t of tris) {
      r -= t.a;
      if (r <= 0) {
        seeds.push(t.c.slice());
        break;
      }
    }
  }
  while (seeds.length < Math.min(count, tris.length)) {
    seeds.push(tris[(Math.random() * tris.length) | 0].c.slice());
  }

  const assignment = new Int32Array(tris.length);
  const assign = () => {
    for (let i = 0; i < tris.length; i++) {
      const c = tris[i].c;
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = c[0] - seeds[s][0];
        const dy = c[1] - seeds[s][1];
        const dz = c[2] - seeds[s][2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      assignment[i] = best;
    }
  };

  for (let pass = 0; pass < 2; pass++) {
    assign();
    const sums = seeds.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < tris.length; i++) {
      const s = assignment[i];
      const w = tris[i].a;
      sums[s][0] += tris[i].c[0] * w;
      sums[s][1] += tris[i].c[1] * w;
      sums[s][2] += tris[i].c[2] * w;
      sums[s][3] += w;
    }
    for (let s = 0; s < seeds.length; s++) {
      if (sums[s][3] > 0) {
        seeds[s][0] = sums[s][0] / sums[s][3];
        seeds[s][1] = sums[s][1] / sums[s][3];
        seeds[s][2] = sums[s][2] / sums[s][3];
      }
    }
  }
  assign();

  const buckets = Array.from({ length: seeds.length }, () => []);
  for (let i = 0; i < tris.length; i++) buckets[assignment[i]].push(tris[i]);
  return buckets.filter((b) => b.length > 0);
}

/**
 * 生成碎裂模板：每块碎片是一团表面顶点的凸包，
 * 因此是有体积的「石块」而不是薄片。
 */
function buildTemplate(piece) {
  const { tris, sources } = collectTriangles(piece);
  const shards = [];
  if (!tris.length) return { shards };

  const buckets = clusterTriangles(tris, Math.min(SHARD_COUNT, Math.max(6, tris.length >> 4)));
  const seen = new Set();
  const points = [];

  for (const bucket of buckets) {
    const centroid = new THREE.Vector3();
    let weight = 0;
    const areaByMat = new Map();
    for (const t of bucket) {
      centroid.x += t.c[0] * t.a;
      centroid.y += t.c[1] * t.a;
      centroid.z += t.c[2] * t.a;
      weight += t.a;
      areaByMat.set(t.m, (areaByMat.get(t.m) || 0) + t.a);
    }
    if (!weight) continue;
    centroid.multiplyScalar(1 / weight);

    let material = null;
    let dominantArea = -1;
    for (const [uuid, area] of areaByMat) {
      if (area > dominantArea) {
        dominantArea = area;
        material = sources.get(uuid);
      }
    }
    if (!material) continue;

    // 表面顶点去重后抽样，凸包计算保持在毫秒级
    seen.clear();
    points.length = 0;
    for (const t of bucket) {
      for (let j = 0; j < 3; j++) {
        const x = t.v[j * 3];
        const y = t.v[j * 3 + 1];
        const z = t.v[j * 3 + 2];
        const key = `${Math.round(x * 400)},${Math.round(y * 400)},${Math.round(z * 400)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(x, y, z);
      }
    }
    const count = points.length / 3;
    if (count < 4) continue;

    const picked = [];
    const stride = Math.max(1, Math.ceil(count / HULL_POINT_CAP));
    for (let i = 0; i < count; i += stride) {
      picked.push(new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
    }
    if (picked.length < 4) continue;

    let geo = null;
    try {
      geo = new ConvexGeometry(picked);
    } catch {
      geo = null;
    }
    if (!geo || !geo.attributes.position || geo.attributes.position.count < 3) {
      geo?.dispose();
      continue;
    }
    geo.translate(-centroid.x, -centroid.y, -centroid.z);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const out = centroid.clone();
    out.y *= 0.35;
    if (out.lengthSq() < 1e-6) {
      out.set(Math.random() - 0.5, 0.3, Math.random() - 0.5);
    }
    out.normalize();

    shards.push({
      geo,
      material,
      centroid,
      out,
      radius: geo.boundingSphere ? geo.boundingSphere.radius : 0.15,
    });
  }

  return { shards };
}

const templates = new Map();

function templateKey(piece) {
  const type = piece.userData?.pieceType;
  const color = piece.userData?.pieceColor;
  return type && color ? `${color}${type}` : null;
}

/** 取（或首次生成）某类棋子的碎裂模板 */
function getTemplate(piece) {
  const key = templateKey(piece);
  if (!key) return buildTemplate(piece);
  let template = templates.get(key);
  if (!template) {
    template = buildTemplate(piece);
    templates.set(key, template);
  }
  return template;
}

/**
 * 开局空闲时预热模板，避免第一次吃子时才计算。
 * 每一步只处理一个模板，不阻塞交互。
 */
export function warmShatterTemplates() {
  const jobs = [];
  for (const color of ['w', 'b']) {
    for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) jobs.push([color, type]);
  }
  const idle =
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (fn) => setTimeout(fn, 80);

  let index = 0;
  const step = () => {
    if (index >= jobs.length) return;
    const [color, type] = jobs[index++];
    const key = `${color}${type}`;
    if (!templates.has(key)) {
      const temp = createPieceMesh(type, color);
      try {
        templates.set(key, buildTemplate(temp));
      } finally {
        temp.traverse((obj) => {
          if (obj.isMesh && obj.geometry) obj.geometry.dispose();
        });
      }
    }
    if (index < jobs.length) idle(step, { timeout: 1200 });
  };
  idle(step, { timeout: 1200 });
}

/* ------------------------------------------------------------------ */
/* 主入口                                                             */
/* ------------------------------------------------------------------ */

function cloneShardMaterial(base) {
  const mat = base.clone();
  mat.transparent = true;
  mat.opacity = 1;
  mat.depthWrite = true;
  mat.side = THREE.FrontSide;
  if (mat.emissive) {
    mat.emissive = new THREE.Color(0xffcf94);
    mat.emissiveIntensity = 0;
  }
  return mat;
}

/**
 * @param {object} opts
 * @param {THREE.Group} opts.piece       被吃的棋子（已摆好）
 * @param {THREE.Object3D} opts.parent   特效挂载的父节点
 * @param {import('./animate.js').Animator} opts.animator
 * @param {number} [opts.delay]          命中前等待的毫秒数（等进攻方落子）
 * @param {boolean} [opts.lowPower]      低配模式：碎片更少、火花更少
 * @param {boolean} [opts.reducedMotion] 系统要求减弱动效时退化为下沉淡出
 * @param {THREE.Vector3|null} [opts.from] 进攻方起点（世界坐标），决定炸开方向
 * @param {Function} [opts.onImpact]     命中瞬间回调（镜头震动）
 * @param {Function} [opts.onDone]       特效结束回调
 * @returns {{kill: Function}}
 */
export function shatterPiece({
  piece,
  parent,
  animator,
  delay = 0,
  lowPower = false,
  reducedMotion = false,
  from = null,
  onImpact = null,
  onDone = null,
}) {
  const anchor = new THREE.Group();
  anchor.name = 'shatter';
  piece.updateWorldMatrix(true, false);
  piece.matrixWorld.decompose(anchor.position, anchor.quaternion, anchor.scale);
  anchor.visible = false;
  parent.add(anchor);

  let disposed = false;
  let built = false;
  let lastRaw = 0;
  const shards = [];
  const sparks = [];
  const ownedMat = [];
  let sparkMat = null;
  let sparkGeo = null;
  let flash = null;
  let dust = null;
  let age = 0;
  let shock = 0;
  let shakeFired = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    parent.remove(anchor);
    for (const mat of ownedMat) mat.dispose();
    if (flash) {
      flash.geometry.dispose();
      flash.material.dispose();
    }
    if (dust) {
      dust.geometry.dispose();
      dust.material.dispose();
    }
    if (sparkGeo) sparkGeo.dispose();
    if (sparkMat) sparkMat.dispose();
    if (onDone) onDone();
  };

  /* ---------------- 命中瞬间才真正生成碎片 ---------------- */
  function build() {
    const template = getTemplate(piece);
    const limit = lowPower ? Math.min(9, template.shards.length) : template.shards.length;

    // 进攻方向（棋子本地坐标）
    const pushDir = new THREE.Vector3(0, 0, 1);
    if (from) {
      const inv = new THREE.Matrix4().copy(piece.matrixWorld).invert();
      _v.copy(from).applyMatrix4(inv);
      pushDir.set(-_v.x, 0, -_v.z);
      if (pushDir.lengthSq() < 1e-6) pushDir.set(0, 0, 1);
      pushDir.normalize();
    }

    for (let i = 0; i < limit; i++) {
      const template_shard = template.shards[i];
      const mat = cloneShardMaterial(template_shard.material);
      ownedMat.push(mat);

      const mesh = new THREE.Mesh(template_shard.geo, mat);
      mesh.position.copy(template_shard.centroid);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      anchor.add(mesh);

      const out = template_shard.out;
      const speed = (lowPower ? 1.4 : 1.7) + Math.random() * 1.7;
      const push = 1.0 + Math.random() * 1.3;
      const height = template_shard.centroid.y;
      shards.push({
        mesh,
        material: mat,
        v: new THREE.Vector3(
          out.x * speed + pushDir.x * push,
          Math.max(1.3, (height / 0.95) * 1.9) + Math.random() * 1.8,
          out.z * speed + pushDir.z * push
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        ),
        floor: FLOOR_Y + Math.max(0.01, template_shard.radius * 0.55),
        bounces: 0,
        rest: false,
      });
    }

    // 命中闪光
    const flashTex = getFlashTexture();
    if (flashTex) {
      flash = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flashTex,
          color: 0xffd7a0,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      flash.center.set(0.5, 0.35);
      flash.position.set(0, 0.28, 0);
      flash.scale.setScalar(0.4);
      anchor.add(flash);
    }

    // 贴地尘埃
    const dustTex = getDustTexture();
    if (dustTex) {
      dust = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: dustTex,
          color: 0xd9c8a8,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      dust.rotation.x = -Math.PI / 2;
      dust.position.y = BOARD_TOP + 0.004;
      dust.scale.setScalar(0.55);
      anchor.add(dust);
    }

    // 金色火花
    sparkGeo = new THREE.OctahedronGeometry(0.045, 0);
    sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffd489,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const sparkCount = lowPower ? 6 : 11;
    for (let i = 0; i < sparkCount; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.position.set(
        (Math.random() - 0.5) * 0.24,
        0.18 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.24
      );
      anchor.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * 3.2;
      sparks.push({
        mesh,
        v: new THREE.Vector3(
          Math.cos(a) * sp + pushDir.x * 1.2,
          1.4 + Math.random() * 3.4,
          Math.sin(a) * sp + pushDir.z * 1.2
        ),
      });
    }

    anchor.visible = true;
    piece.visible = false;
    shock = 0.075;

    if (onImpact && !shakeFired) {
      shakeFired = true;
      onImpact();
    }
  }

  function step(dt) {
    age += dt;

    // 挤压回弹：碎片整体先被压扁再弹开
    if (shock > 0) {
      shock = Math.max(0, shock - dt);
      const k = shock / 0.075;
      anchor.scale.set(1.16 - 0.16 * k, 0.82 + 0.18 * k, 1.16 - 0.16 * k);
    } else if (anchor.scale.x !== 1 || anchor.scale.y !== 1) {
      anchor.scale.set(1, 1, 1);
    }

    for (const s of shards) {
      if (!s.rest) {
        s.v.y += GRAVITY * dt;
        s.mesh.position.addScaledVector(s.v, dt);
        if (s.mesh.position.y < s.floor) {
          s.mesh.position.y = s.floor;
          if (s.bounces < 1 && s.v.y < -0.6) {
            s.bounces++;
            s.v.y = -s.v.y * 0.34;
            s.v.x *= 0.55;
            s.v.z *= 0.55;
            s.spin.multiplyScalar(0.5);
          } else {
            s.rest = true;
            s.v.set(0, 0, 0);
            s.spin.multiplyScalar(0.2);
          }
        }
      }
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      s.spin.multiplyScalar(Math.max(0, 1 - 4.5 * dt));
    }

    // 闪光：极快地炸开后消失
    if (flash) {
      const k = Math.min(1, age / 0.18);
      flash.scale.setScalar(0.45 + k * 2.1);
      flash.material.opacity = 0.9 * (1 - k) * (1 - k);
    }

    // 尘埃扩散
    if (dust) {
      const k = Math.min(1, age / 0.36);
      dust.scale.setScalar(0.55 + k * 1.35);
      dust.material.opacity = 0.34 * (1 - k) * (1 - k);
    }

    // 火花
    if (sparkMat) {
      const fade = Math.max(0, 1 - age / 0.5);
      sparkMat.opacity = fade;
      for (const s of sparks) {
        s.v.y += GRAVITY * 0.75 * dt;
        s.mesh.position.addScaledVector(s.v, dt);
        s.mesh.rotation.x += dt * 9;
        s.mesh.rotation.z += dt * 7;
      }
    }

    // 碎片高光闪烁 + 后段淡出
    const glow = Math.max(0, 1 - age / 0.15);
    const fade = age < 0.34 ? 1 : Math.max(0, 1 - (age - 0.34) / 0.2);
    for (const s of shards) {
      const mat = s.material;
      if (mat.emissive) mat.emissiveIntensity = glow * 0.55;
      mat.opacity = fade;
    }
  }

  const run = (t, raw) => {
    if (disposed) return;
    if (!built) {
      built = true;
      build();
      lastRaw = raw;
      if (!shards.length) dispose();
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (raw - lastRaw) * (DURATION / 1000)));
    lastRaw = raw;
    step(dt);
    if (raw >= 1) dispose();
  };

  if (reducedMotion) {
    built = true;
    animator.add({
      duration: 220,
      delay,
      easing: (t) => t,
      onUpdate: (t) => {
        piece.scale.setScalar(Math.max(0.001, 1 - t * 0.9));
        piece.position.y = BOARD_TOP - t * 0.06;
      },
      onComplete: () => {
        piece.visible = false;
        piece.scale.setScalar(1);
        dispose();
      },
    });
  } else {
    animator.add({
      duration: DURATION,
      delay,
      easing: (t) => t,
      onUpdate: run,
      onComplete: () => dispose(),
    });
  }

  return {
    kill: () => {
      if (!disposed) dispose();
    },
  };
}

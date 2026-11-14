import * as THREE from 'three';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';

/**
 * 程序化生成的三维棋子。
 * 全部使用基础几何体组合，无需任何外部模型资源。
 */

const IVORY = new THREE.MeshPhysicalMaterial({
  color: 0xefe3cb,
  roughness: 0.34,
  metalness: 0.02,
  clearcoat: 0.8,
  clearcoatRoughness: 0.24,
  sheen: 0.4,
  sheenColor: new THREE.Color(0xfff6e6),
});

const OBSIDIAN = new THREE.MeshPhysicalMaterial({
  color: 0x2b2c36,
  roughness: 0.3,
  metalness: 0.25,
  clearcoat: 0.95,
  clearcoatRoughness: 0.18,
});

const GOLD = new THREE.MeshPhysicalMaterial({
  color: 0xd9b25f,
  roughness: 0.28,
  metalness: 1,
  clearcoat: 0.6,
  clearcoatRoughness: 0.2,
});

const SLIT = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.6, metalness: 0.2 });

export const PIECE_MATERIALS = { w: IVORY, b: OBSIDIAN, gold: GOLD };

export const PIECE_HEIGHT = {
  p: 0.55,
  r: 0.68,
  n: 0.77,
  b: 0.8,
  q: 0.94,
  k: 1.06,
};

/** 用平滑样条把控制点变成旋转体轮廓 */
function lathe(control, segments = 48, samples = 64) {
  const pts = control.map(([x, y]) => new THREE.Vector2(x, y));
  const curve = new THREE.SplineCurve(pts);
  const profile = curve.getPoints(samples);
  const geo = new THREE.LatheGeometry(profile, segments);
  geo.computeVertexNormals();
  return geo;
}

function addMesh(group, geo, material = IVORY) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/* ------------------------------- 棋子 ------------------------------- */

function buildPawn(material) {
  const g = new THREE.Group();
  addMesh(g, lathe([
    [0, 0], [0.2, 0], [0.2, 0.024], [0.178, 0.046], [0.12, 0.078], [0.098, 0.105],
    [0.09, 0.17], [0.094, 0.225], [0.112, 0.256], [0.132, 0.268], [0.132, 0.286],
    [0.104, 0.30], [0.086, 0.318], [0.082, 0.332],
  ]), material);
  const head = addMesh(g, new THREE.SphereGeometry(0.117, 40, 28), material);
  head.position.y = 0.425;
  head.scale.set(1, 1.02, 1);
  return g;
}

function buildRook(material) {
  const g = new THREE.Group();
  addMesh(g, lathe([
    [0, 0], [0.235, 0], [0.235, 0.028], [0.207, 0.055], [0.148, 0.088], [0.128, 0.115],
    [0.12, 0.2], [0.124, 0.3], [0.136, 0.38], [0.17, 0.43], [0.19, 0.462],
    [0.19, 0.492], [0.152, 0.502], [0.168, 0.52], [0.168, 0.595], [0.196, 0.608],
    [0.196, 0.625], [0.152, 0.632], [0.146, 0.60], [0.146, 0.545], [0, 0.54],
  ]), material);

  // 城垛
  const notch = new THREE.BoxGeometry(0.1, 0.075, 0.075);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = addMesh(g, notch, material);
    m.position.set(Math.cos(a) * 0.172, 0.66, Math.sin(a) * 0.172);
    m.rotation.y = -a;
  }
  return g;
}

function ensureOutward(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const index = geo.index;
  const count = index ? index.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < count; i += 3) {
    const i0 = index ? index.getX(i) : i;
    const i1 = index ? index.getX(i + 1) : i + 1;
    const i2 = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    volume += a.dot(b.clone().cross(c));
  }
  if (volume < 0) {
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const tmp = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, tmp);
      }
      index.needsUpdate = true;
    }
    geo.computeVertexNormals();
  }
  return geo;
}

function buildKnight(material) {
  const g = new THREE.Group();
  addMesh(g, lathe([
    [0, 0], [0.245, 0], [0.245, 0.03], [0.22, 0.06], [0.175, 0.09], [0.163, 0.12],
    [0.172, 0.15], [0.185, 0.185], [0.185, 0.22], [0.172, 0.245], [0.15, 0.26], [0, 0.262],
  ]), material);

  // 用一系列椭圆截面放样出弯颈与马头
  const profile = [
    { y: 0.18, cx: -0.015, rx: 0.15, rz: 0.13 },
    { y: 0.3, cx: -0.05, rx: 0.145, rz: 0.12 },
    { y: 0.41, cx: -0.07, rx: 0.135, rz: 0.11 },
    { y: 0.5, cx: -0.06, rx: 0.13, rz: 0.1 },
    { y: 0.565, cx: -0.02, rx: 0.14, rz: 0.095 },
    { y: 0.615, cx: 0.04, rx: 0.155, rz: 0.095 },
    { y: 0.66, cx: 0.1, rx: 0.16, rz: 0.09 },
    { y: 0.695, cx: 0.155, rx: 0.135, rz: 0.075 },
    { y: 0.722, cx: 0.19, rx: 0.085, rz: 0.055 },
    { y: 0.734, cx: 0.212, rx: 0.045, rz: 0.032 },
  ];
  const N = 28;
  const sections = profile.map((s) => {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(s.cx + Math.cos(ang) * s.rx, s.y, Math.sin(ang) * s.rz));
    }
    return pts;
  });
  const loft = ensureOutward(new LoftGeometry(sections, { closed: true, capStart: true, capEnd: true }));
  addMesh(g, loft, material);

  // 耳朵
  const earGeo = new THREE.ConeGeometry(0.035, 0.11, 14);
  for (const z of [-0.048, 0.048]) {
    const ear = addMesh(g, earGeo, material);
    ear.position.set(-0.05, 0.735, z);
    ear.rotation.z = 0.26;
    ear.rotation.x = z > 0 ? -0.16 : 0.16;
  }

  // 鬃毛脊线
  const crestShape = new THREE.Shape();
  crestShape.moveTo(-0.14, 0.225);
  crestShape.bezierCurveTo(-0.205, 0.28, -0.22, 0.38, -0.195, 0.48);
  crestShape.bezierCurveTo(-0.17, 0.555, -0.125, 0.615, -0.075, 0.645);
  crestShape.lineTo(-0.045, 0.625);
  crestShape.bezierCurveTo(-0.105, 0.57, -0.155, 0.5, -0.172, 0.42);
  crestShape.bezierCurveTo(-0.185, 0.34, -0.165, 0.27, -0.11, 0.215);
  crestShape.closePath();
  const crestGeo = new THREE.ExtrudeGeometry(crestShape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.014,
    bevelSegments: 2,
    curveSegments: 16,
  });
  crestGeo.translate(0, 0, -0.0275);
  addMesh(g, crestGeo, material);

  // 眼睛
  const eyeGeo = new THREE.SphereGeometry(0.019, 12, 10);
  for (const z of [-0.083, 0.083]) {
    const eye = new THREE.Mesh(eyeGeo, SLIT);
    eye.position.set(0.055, 0.655, z);
    g.add(eye);
  }

  return g;
}

function buildBishop(material) {
  const g = new THREE.Group();
  addMesh(g, lathe([
    [0, 0], [0.215, 0], [0.215, 0.026], [0.19, 0.052], [0.135, 0.082], [0.108, 0.11],
    [0.098, 0.18], [0.102, 0.27], [0.112, 0.35], [0.132, 0.395], [0.166, 0.42],
    [0.172, 0.444], [0.132, 0.462], [0.118, 0.482], [0.126, 0.508], [0.14, 0.538],
    [0.144, 0.575], [0.132, 0.615], [0.108, 0.655], [0.078, 0.69], [0.046, 0.718],
    [0.022, 0.738], [0, 0.748],
  ]), material);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.011, 12, 44), GOLD);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.522;
  ring.castShadow = true;
  g.add(ring);

  const finial = addMesh(g, new THREE.SphereGeometry(0.032, 24, 16), GOLD);
  finial.position.y = 0.768;
  return g;
}

function buildQueen(material) {
  const g = new THREE.Group();
  addMesh(g, lathe([
    [0, 0], [0.255, 0], [0.255, 0.028], [0.228, 0.058], [0.168, 0.092], [0.13, 0.118],
    [0.117, 0.21], [0.121, 0.31], [0.132, 0.41], [0.152, 0.49], [0.186, 0.538],
    [0.192, 0.562], [0.152, 0.582], [0.134, 0.598], [0.158, 0.628], [0.183, 0.678],
    [0.19, 0.718], [0.172, 0.74], [0.134, 0.748], [0.118, 0.762], [0.132, 0.78],
    [0.146, 0.798], [0.132, 0.812], [0.1, 0.82], [0.078, 0.83], [0.078, 0.836], [0, 0.838],
  ]), material);

  const crownGeo = new THREE.SphereGeometry(0.033, 20, 14);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = addMesh(g, crownGeo, GOLD);
    m.position.set(Math.cos(a) * 0.143, 0.836, Math.sin(a) * 0.143);
  }
  const orb = addMesh(g, new THREE.SphereGeometry(0.062, 30, 20), GOLD);
  orb.position.y = 0.872;
  return g;
}

function buildKing(material) {
  const g = new THREE.Group();
  addMesh(g, lathe([
    [0, 0], [0.27, 0], [0.27, 0.03], [0.242, 0.062], [0.175, 0.096], [0.136, 0.122],
    [0.122, 0.22], [0.126, 0.33], [0.137, 0.44], [0.156, 0.53], [0.19, 0.582],
    [0.196, 0.606], [0.156, 0.626], [0.138, 0.642], [0.162, 0.678], [0.186, 0.738],
    [0.19, 0.782], [0.17, 0.806], [0.136, 0.818], [0.12, 0.834], [0.13, 0.854],
    [0.142, 0.874], [0.12, 0.89], [0.09, 0.9], [0.09, 0.906], [0, 0.908],
  ]), material);

  const v = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.21, 0.072), GOLD);
  v.position.y = 0.985;
  v.castShadow = true;
  g.add(v);
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), GOLD);
  h.position.y = 1.008;
  h.castShadow = true;
  g.add(h);
  return g;
}

const BUILDERS = {
  p: buildPawn,
  r: buildRook,
  n: buildKnight,
  b: buildBishop,
  q: buildQueen,
  k: buildKing,
};

/**
 * 创建棋子（以底面中心为原点）
 * @param {string} type p/n/b/r/q/k
 * @param {'w'|'b'} color
 */
export function createPieceMesh(type, color) {
  const material = color === 'w' ? IVORY : OBSIDIAN;
  const build = BUILDERS[type];
  const group = build(material);
  group.userData.pieceType = type;
  group.userData.pieceColor = color;

  // 朝向对手
  if (type === 'n') group.rotation.y = color === 'w' ? Math.PI / 2 : -Math.PI / 2;

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

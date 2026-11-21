import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Animator, easeInOutCubic } from './animate.js';

export const CAMERA_VIEWS = {
  white: { position: new THREE.Vector3(0, 10.7, 11.3), target: new THREE.Vector3(0, 0.2, 0) },
  black: { position: new THREE.Vector3(0, 10.7, -11.3), target: new THREE.Vector3(0, 0.2, 0) },
  angle: { position: new THREE.Vector3(7.4, 9.2, 9.2), target: new THREE.Vector3(0, 0.2, 0) },
  top: { position: new THREE.Vector3(0, 16.5, 0.01), target: new THREE.Vector3(0, 0, 0) },
};

/** 根据屏幕比例计算取景，桌面端让出右侧面板的位置 */
export function buildView(name) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / Math.max(1, h);
  const mobile = aspect < 0.92;
  const panelHalf = w >= 980 ? 168 : w >= 780 ? 149 : 0;
  const offset = panelHalf
    ? Math.min(1.7, Math.max(1.0, (panelHalf * 11.36) / Math.max(1, h)))
    : 0;
  const base = CAMERA_VIEWS[name] || CAMERA_VIEWS.white;
  const position = base.position.clone();
  const target = base.target.clone();
  let fov = 38;

  if (mobile) {
    fov = name === 'top' ? 46 : 55;
    if (name === 'white') {
      position.set(0, 19.6, 13.8);
      target.set(0, 0.1, 0);
    } else if (name === 'black') {
      position.set(0, 19.6, -13.8);
      target.set(0, 0.1, 0);
    } else if (name === 'angle') {
      position.set(11, 17, 13.4);
      target.set(0, 0.1, 0);
    } else if (name === 'top') {
      position.set(0, 22, 0.01);
    }
  } else {
    position.x += offset;
    target.x += offset;
  }
  return { position, target, fov };
}

export function createScene(canvas) {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const small = window.innerWidth < 820;
  const lowPower = coarse || small;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.6 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0d13, 22, 60);

  const camera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(0, 17.5, 20);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.85;
  controls.minDistance = 6.5;
  controls.maxDistance = window.innerWidth / window.innerHeight < 0.92 ? 34 : 24;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = 1.46;
  controls.update();

  // 环境反射
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.05);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42;
  room.dispose();
  pmrem.dispose();

  /* --------------------------- 灯光 --------------------------- */
  const hemi = new THREE.HemisphereLight(0xbdd4ff, 0x1a1410, 0.5);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dc, 2.3);
  key.position.set(5.5, 11.5, 7.5);
  key.castShadow = true;
  key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  key.shadow.camera.left = -7.5;
  key.shadow.camera.right = 7.5;
  key.shadow.camera.top = 7.5;
  key.shadow.camera.bottom = -7.5;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 32;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 3;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x86a8ff, 0.7);
  fill.position.set(-8, 5.5, -5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffcf9a, 1.0);
  rim.position.set(-3.5, 4.5, -9);
  scene.add(rim);

  const warm = new THREE.PointLight(0xffb877, 16, 24, 2);
  warm.position.set(0, 6.2, 0);
  scene.add(warm);

  /* --------------------------- 地面 --------------------------- */
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0e1118,
    roughness: 0.42,
    metalness: 0.35,
    envMapIntensity: 0.35,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.63;
  ground.receiveShadow = true;
  scene.add(ground);

  // 地面上的暖色光晕
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  const gradient = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 205, 140, 0.5)');
  gradient.addColorStop(0.45, 'rgba(255, 185, 120, 0.14)');
  gradient.addColorStop(1, 'rgba(255, 180, 110, 0)');
  gctx.fillStyle = gradient;
  gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(19, 19),
    new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.615;
  scene.add(glow);

  const animator = new Animator();

  let lastMobile = window.innerWidth / window.innerHeight < 0.92;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.maxDistance = w / h < 0.92 ? 34 : 24;
  }

  function flyTo(view, { duration = 900 } = {}) {
    const target = view.target.clone();
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startSph = new THREE.Spherical().setFromVector3(startPos.clone().sub(startTarget));
    const endSph = new THREE.Spherical().setFromVector3(view.position.clone().sub(target));
    const startFov = camera.fov;
    const endFov = view.fov || camera.fov;

    // 选择最短旋转方向
    let dTheta = endSph.theta - startSph.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;

    return animator.add({
      duration,
      easing: easeInOutCubic,
      onUpdate: (t) => {
        const sph = new THREE.Spherical(
          startSph.radius + (endSph.radius - startSph.radius) * t,
          startSph.phi + (endSph.phi - startSph.phi) * t,
          startSph.theta + dTheta * t
        );
        controls.target.lerpVectors(startTarget, target, t);
        const offset = new THREE.Vector3().setFromSpherical(sph);
        camera.position.copy(controls.target).add(offset);
        camera.lookAt(controls.target);
        if (startFov !== endFov) {
          camera.fov = startFov + (endFov - startFov) * t;
          camera.updateProjectionMatrix();
        }
      },
    });
  }

  function flyToView(name, opts) {
    return flyTo(buildView(name), opts);
  }

  function intro() {
    const start = buildView('angle');
    start.position.multiplyScalar(1.18);
    return flyTo(start, { duration: 1400 }).then(() => flyToView('white', { duration: 1000 }));
  }

  let frameId = null;
  let last = performance.now();
  let onFrame = null;

  function loop(now) {
    frameId = requestAnimationFrame(loop);
    const dt = Math.min(64, now - last);
    last = now;
    animator.update(dt);
    controls.update();
    if (onFrame) onFrame(dt / 1000, now / 1000);
    renderer.render(scene, camera);
  }

  function start(renderCallback) {
    onFrame = renderCallback;
    last = performance.now();
    if (frameId === null) frameId = requestAnimationFrame(loop);
  }

  function dispose() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    renderer.dispose();
  }

  window.addEventListener('resize', () => {
    const mobile = window.innerWidth / window.innerHeight < 0.92;
    resize();
    if (mobile !== lastMobile) {
      lastMobile = mobile;
      flyToView('white', { duration: 700 });
    }
  });
  resize();

  return {
    renderer,
    scene,
    camera,
    controls,
    animator,
    resize,
    flyTo,
    flyToView,
    buildView,
    intro,
    start,
    dispose,
  };
}

// Kallpa · Montaña de Colores — plataformero de velocidad 2.5D.
// El nivel (datos/nivel1.glb) sale de generador_nivel.py; Blender X→X, Z→Y, Y→-Z.
// El jugador corre en el plano z≈0 y sigue la superficie (suelo, rampas, loop).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ------------------------------------------------------------ constantes
const F = {
  G: 30,        // gravedad (m/s²)
  PEND: 0.45,   // cuánto pesa la gravedad sobre la pendiente al ir pegado
  ACC: 16, DEC: 45, FRIC: 9,
  TOP: 24,      // velocidad máxima corriendo
  MAX: 42,      // tope absoluto (bajadas, rebotes)
  AIRE: 12, SALTO: 13, REBOTE: 19,
  PEGUE: 7,     // bajo esta velocidad se despega del techo del loop
  ALTO: 0.6,    // altura del origen de los rayos sobre los pies
};
const LOOP = { cx: 112, cy: 7.08, carril: 1.6, entrada: 112, previo: 103 };
const META_X = 171;
const PUNTOS_REGRESO = [{ x: 2, y: 2 }, { x: 92, y: 2 }];

// ------------------------------------------------------------ escena
const lienzo = document.createElement('canvas');
document.body.prepend(lienzo);
const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
render.setPixelRatio(Math.min(devicePixelRatio, 2));
render.shadowMap.enabled = true;
render.shadowMap.type = THREE.PCFSoftShadowMap;

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x7fa6de);
escena.fog = new THREE.Fog(0x9db8e2, 120, 320);
const camara = new THREE.PerspectiveCamera(40, 1, 0.1, 600);

escena.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a5a3c, 1.5));
const sol = new THREE.DirectionalLight(0xfff1dc, 2.6);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -30, right: 30, top: 20, bottom: -20, near: 1, far: 120 });
escena.add(sol, sol.target);

function ajustar() {
  render.setSize(innerWidth, innerHeight);
  camara.aspect = innerWidth / innerHeight;
  // en vertical (celular) alejar para ver lo que viene
  camara.fov = camara.aspect < 1 ? 62 : 40;
  camara.updateProjectionMatrix();
}
addEventListener('resize', ajustar);
ajustar();

// ------------------------------------------------------------ sonido (Web Audio, sin archivos)
let audio = null;
function tono(frec, dur, tipo = 'square', vol = 0.12, desliz = 0) {
  if (!audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(frec, t);
  if (desliz) o.frequency.exponentialRampToValueAtTime(frec * desliz, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur);
}
const sonar = {
  salto: () => tono(330, 0.18, 'square', 0.08, 2),
  cristal: () => { tono(1320, 0.08, 'triangle', 0.1); setTimeout(() => tono(1760, 0.12, 'triangle', 0.1), 60); },
  rebote: () => tono(180, 0.35, 'sine', 0.2, 4),
  caida: () => tono(400, 0.6, 'sawtooth', 0.08, 0.2),
  meta: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tono(f, 0.25, 'triangle', 0.12), i * 120)),
};

// ------------------------------------------------------------ Kallpa (personaje original)
function crearKallpa() {
  const raiz = new THREE.Group();         // se alinea con la normal del suelo
  const espejo = new THREE.Group();       // scale.x = ±1 según hacia dónde mira
  const giro = new THREE.Group();         // voltereta del salto, pivote en el torso
  giro.position.y = 0.55;
  raiz.add(espejo);
  espejo.add(giro);
  espejo.scale.setScalar(1.45);

  const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const pelaje = mat(0x9c958c), panza = mat(0xf1e4cc), oscuro = mat(0x2b2220, 0.5),
        rosado = mat(0xe8a0a0), ojota = mat(0x2aa198, 0.6), chalina = mat(0xc2264f, 0.9),
        franja = mat(0xf2b134, 0.9);
  const esfera = new THREE.SphereGeometry(1, 20, 14);
  const pieza = (geo, m, x, y, z, sx = 1, sy = sx, sz = sx) => {
    const p = new THREE.Mesh(geo, m);
    p.position.set(x, y, z);
    p.scale.set(sx, sy, sz);
    p.castShadow = true;
    return p;
  };

  giro.add(pieza(esfera, pelaje, 0, 0, 0, 0.36, 0.4, 0.32));            // cuerpo
  giro.add(pieza(esfera, panza, 0.14, -0.04, 0, 0.24, 0.3, 0.26));       // guata
  const cabeza = new THREE.Group();
  cabeza.position.set(0.14, 0.44, 0);
  giro.add(cabeza);
  cabeza.add(pieza(esfera, pelaje, 0, 0, 0, 0.27, 0.25, 0.25));
  cabeza.add(pieza(esfera, panza, 0.16, -0.06, 0, 0.14, 0.12, 0.16));    // hocico
  cabeza.add(pieza(esfera, oscuro, 0.29, -0.03, 0, 0.04));               // nariz
  for (const z of [-0.12, 0.12]) {
    cabeza.add(pieza(esfera, oscuro, 0.17, 0.06, z, 0.055, 0.07, 0.05));
    cabeza.add(pieza(esfera, panza, 0.205, 0.085, z * 1.05, 0.018));    // brillo
  }
  // orejas largas que se echan atrás con la velocidad
  const orejas = [];
  const orejaGeo = new THREE.CapsuleGeometry(0.075, 0.42, 4, 10);
  for (const z of [-0.1, 0.1]) {
    const o = new THREE.Group();
    o.position.set(-0.04, 0.16, z);
    o.add(pieza(orejaGeo, pelaje, 0, 0.26, 0, 1, 1, 0.55));
    o.add(pieza(orejaGeo, rosado, 0.03, 0.26, 0, 0.6, 0.85, 0.35));
    cabeza.add(o);
    orejas.push(o);
  }
  // chalina tejida con dos puntas al viento
  const cuello = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 20), chalina);
  cuello.position.set(0.06, 0.28, 0);
  cuello.rotation.set(Math.PI / 2, 0.35, 0);
  giro.add(cuello);
  const puntas = [];
  for (const z of [-0.06, 0.06]) {
    const p = new THREE.Group();
    p.position.set(-0.12, 0.28, z);
    const tela = pieza(new THREE.BoxGeometry(0.42, 0.1, 0.03), chalina, -0.21, 0, 0);
    tela.add(pieza(new THREE.BoxGeometry(0.06, 0.104, 0.034), franja, -0.15, 0, 0));
    p.add(tela);
    giro.add(p);
    puntas.push(p);
  }
  // cola enroscada hacia arriba con punta oscura
  const cola = new THREE.Group();
  cola.position.set(-0.3, -0.12, 0);
  giro.add(cola);
  for (let i = 0; i < 7; i++) {
    const a = i / 6;
    cola.add(pieza(esfera, i > 4 ? oscuro : pelaje,
      -0.1 - 0.28 * Math.sin(a * 2.2), 0.06 + 0.4 * a * a, 0, 0.1 - a * 0.03));
  }
  // patas con ojotas
  const patas = [];
  for (const z of [-0.14, 0.14]) {
    const p = new THREE.Group();
    p.position.set(0, -0.2, z);
    p.add(pieza(new THREE.CapsuleGeometry(0.07, 0.2, 4, 8), pelaje, 0, -0.17, 0));
    p.add(pieza(new THREE.BoxGeometry(0.3, 0.07, 0.15), ojota, 0.07, -0.33, 0));
    giro.add(p);
    patas.push(p);
  }
  const brazos = [];
  for (const z of [-0.2, 0.2]) {
    const b = new THREE.Group();
    b.position.set(0.12, 0.12, z);
    b.add(pieza(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), pelaje, 0, -0.1, 0));
    giro.add(b);
    brazos.push(b);
  }
  return { raiz, espejo, giro, orejas, puntas, cola, patas, brazos };
}
const kallpa = crearKallpa();
escena.add(kallpa.raiz);

// ------------------------------------------------------------ estado
const j = {
  pos: new THREE.Vector2(), vel: new THREE.Vector2(), n: new THREE.Vector2(0, 1),
  gsp: 0, enSuelo: false, mira: 1, fase: 0, volteo: 0, angulo: 0,
  z: 0, enLoop: false, loopHecho: false, t: 0, xPrev: 0,
};
let suelo = [], mallaLoop = null, cristales = [], total = 0;
let juntados = 0, tiempo = 0, jugando = false, terminado = false;

const teclas = { izq: false, der: false, salto: false, freno: false };
let saltoPedido = false;

// ------------------------------------------------------------ rayos
const rayo = new THREE.Raycaster();
rayo.firstHitOnly = true;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function lanzar(ox, oy, dx, dy, lejos, lista) {
  rayo.set(_o.set(ox, oy, j.z), _d.set(dx, dy, 0));
  rayo.far = lejos;
  const h = rayo.intersectObjects(lista, false)[0];
  if (!h) return null;
  const n3 = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  const n = new THREE.Vector2(n3.x, n3.y);
  if (n.lengthSq() < 1e-4) return null;
  return { dist: h.distance, n: n.normalize(), obj: h.object };
}
const tangente = (n) => new THREE.Vector2(n.y, -n.x);
const colisiones = () => (j.enLoop ? [...suelo, mallaLoop] : suelo);
const esLlareta = (o) => o.name.startsWith('SM_Llareta');

// Dos rayos separados a lo largo del suelo: evita caer entre tablones y suaviza el loop.
function sondear(origen, n, lejos) {
  const t = tangente(n), lista = colisiones();
  let mejor = null, suma = new THREE.Vector2();
  for (const s of [-0.25, 0.25]) {
    const h = lanzar(origen.x + t.x * s, origen.y + t.y * s, -n.x, -n.y, lejos, lista);
    if (!h) continue;
    suma.add(h.n);
    if (!mejor || h.dist < mejor.dist) mejor = h;
  }
  if (mejor) mejor.nMedia = suma.normalize();
  return mejor;
}

// ------------------------------------------------------------ física
function despegar(vel) {
  j.enSuelo = false;
  j.vel.copy(vel);
}

function pasoSuelo(dt) {
  const t = tangente(j.n);
  j.gsp += -F.G * F.PEND * t.y * dt;

  const dir = (teclas.der ? 1 : 0) - (teclas.izq ? 1 : 0);
  if (teclas.freno) {
    j.gsp -= Math.sign(j.gsp) * Math.min(Math.abs(j.gsp), F.DEC * dt);
  } else if (dir !== 0) {
    if (j.gsp * dir < 0) j.gsp += dir * F.DEC * dt;
    else if (Math.abs(j.gsp) < F.TOP) j.gsp = dir * Math.min(F.TOP, Math.abs(j.gsp) + F.ACC * dt);
    j.mira = dir;
  }
  if (dir === 0 || Math.abs(j.gsp) > F.TOP) {
    // sin teclas frena; sobre la máxima pierde de a poco el impulso extra
    const fr = dir === 0 ? F.FRIC : F.FRIC * 0.4;
    j.gsp -= Math.sign(j.gsp) * Math.min(Math.abs(j.gsp), fr * dt);
  }
  j.gsp = THREE.MathUtils.clamp(j.gsp, -F.MAX, F.MAX);

  // pared delante (fuera del loop)
  if (!j.enLoop && Math.abs(j.gsp) > 0.01) {
    const s = Math.sign(j.gsp);
    const h = lanzar(j.pos.x + j.n.x * 0.7, j.pos.y + j.n.y * 0.7, t.x * s, t.y * s,
                     0.35 + Math.abs(j.gsp) * dt, suelo);
    if (h && Math.abs(h.n.y) < 0.45) j.gsp = 0;
  }

  j.pos.addScaledVector(t, j.gsp * dt);

  // pegarse a la superficie
  const origen = j.pos.clone().addScaledVector(j.n, F.ALTO);
  const h = sondear(origen, j.n, F.ALTO + 0.4 + Math.abs(j.gsp) * dt);
  if (!h) return despegar(t.multiplyScalar(j.gsp));
  j.pos.addScaledVector(j.n, -(h.dist - F.ALTO));
  j.n.copy(h.nMedia);

  if (esLlareta(h.obj)) return rebotar(tangente(j.n).multiplyScalar(j.gsp * 0.7));
  if (j.n.y < -0.1 && Math.abs(j.gsp) < F.PEGUE) {
    return despegar(tangente(j.n).multiplyScalar(j.gsp).addScaledVector(j.n, 1));
  }
  if (saltoPedido) {
    saltoPedido = false;
    j.volteo = 1;
    sonar.salto();
    despegar(tangente(j.n).multiplyScalar(j.gsp).addScaledVector(j.n, F.SALTO));
  }
}

function rebotar(vel) {
  vel.y = F.REBOTE;
  j.volteo = 1;
  sonar.rebote();
  despegar(vel);
}

function pasoAire(dt) {
  j.vel.y -= F.G * dt;
  const dir = (teclas.der ? 1 : 0) - (teclas.izq ? 1 : 0);
  if (dir) {
    j.mira = dir;
    if (j.vel.x * dir < F.TOP) j.vel.x += dir * F.AIRE * dt;
  }
  // pared lateral
  if (Math.abs(j.vel.x) > 0.01) {
    const s = Math.sign(j.vel.x);
    const h = lanzar(j.pos.x, j.pos.y + F.ALTO, s, 0, 0.35 + Math.abs(j.vel.x) * dt, colisiones());
    if (h && Math.abs(h.n.y) < 0.45) j.vel.x = 0;
  }
  j.pos.addScaledVector(j.vel, dt);

  if (j.vel.y <= 0) {
    const lejos = F.ALTO + -j.vel.y * dt + 0.05;
    const h = sondear(new THREE.Vector2(j.pos.x, j.pos.y + F.ALTO), new THREE.Vector2(0, 1), lejos);
    if (h && h.nMedia.y > 0.2) {
      j.pos.y += F.ALTO - h.dist;
      j.n.copy(h.nMedia);
      if (esLlareta(h.obj)) return rebotar(new THREE.Vector2(j.vel.x, 0));
      j.gsp = j.vel.dot(tangente(j.n));
      j.enSuelo = true;
      j.volteo = 0;
    }
  }
  saltoPedido = false;
}

// El loop es una hélice: entra por z=+1.6 y sale por z=-1.6, así la pista no choca consigo misma.
function seguirLoop(dt) {
  if (!j.enLoop && !j.loopHecho && j.enSuelo && j.gsp > 0 && j.xPrev < LOOP.entrada && j.pos.x >= LOOP.entrada && j.pos.y < 0.6) {
    j.enLoop = true;
    j.t = 0;
  }
  if (j.enLoop) {
    const crudo = Math.atan2(j.pos.x - LOOP.cx, LOOP.cy - j.pos.y);
    let d = crudo - j.t;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    j.t += d;
    if (j.t >= 2 * Math.PI - 0.1) { j.enLoop = false; j.loopHecho = true; }
    else if (j.t < -0.1) { j.enLoop = false; }
    else j.z = LOOP.carril * (1 - 2 * THREE.MathUtils.clamp(j.t / (2 * Math.PI), 0, 1));
  }
  if (!j.enLoop) {
    if (j.pos.x < 100 || j.pos.x > 125) j.loopHecho = false;
    let meta = 0;
    if (!j.loopHecho && j.pos.x > LOOP.previo && j.pos.x < LOOP.entrada + 0.5) {
      meta = LOOP.carril * THREE.MathUtils.smoothstep(j.pos.x, LOOP.previo, LOOP.entrada - 1);
    }
    j.z += THREE.MathUtils.clamp(meta - j.z, -3 * dt, 3 * dt);
  }
  j.xPrev = j.pos.x;
}

function paso(dt) {
  if (j.enSuelo) pasoSuelo(dt); else pasoAire(dt);
  seguirLoop(dt);

  if (j.pos.y < -16) {
    sonar.caida();
    const p = PUNTOS_REGRESO.filter((q) => q.x <= j.pos.x).pop() || PUNTOS_REGRESO[0];
    reiniciarJugador(p.x, p.y);
  }
  // cristales
  const cx = j.pos.x + j.n.x * 0.6, cy = j.pos.y + j.n.y * 0.6;
  for (const c of cristales) {
    if (!c.visible) continue;
    if ((c.position.x - cx) ** 2 + (c.position.y - cy) ** 2 < 1.3) {
      c.visible = false;
      juntados++;
      sonar.cristal();
    }
  }
  if (!terminado && j.pos.x > META_X) terminar();
}

// ------------------------------------------------------------ dibujo
const _foco = new THREE.Vector3();
function dibujar(dt, reloj) {
  const k = kallpa;
  k.raiz.position.set(j.pos.x, j.pos.y, j.z);
  const objetivo = j.enSuelo ? Math.atan2(-j.n.x, j.n.y) : 0;
  let d = objetivo - j.angulo;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  j.angulo += d * Math.min(1, dt * (j.enSuelo ? 25 : 4));
  k.raiz.rotation.z = j.angulo;
  k.espejo.scale.x += (j.mira * 1.45 - k.espejo.scale.x) * Math.min(1, dt * 14);

  const rapidez = j.enSuelo ? Math.abs(j.gsp) : j.vel.length();
  if (j.enSuelo) j.fase += Math.abs(j.gsp) * dt * 1.6;
  const amp = j.enSuelo ? Math.min(1.1, Math.abs(j.gsp) / 8) : 0.25;
  k.patas.forEach((p, i) => (p.rotation.z = Math.sin(j.fase + i * Math.PI) * amp));
  k.brazos.forEach((b, i) => (b.rotation.z = -Math.sin(j.fase + i * Math.PI) * amp * 0.8));
  const viento = Math.min(1, rapidez / F.TOP);
  k.orejas.forEach((o, i) => (o.rotation.z = 0.25 + viento * 0.9 + Math.sin(reloj * 9 + i) * 0.05));
  k.puntas.forEach((p, i) => (p.rotation.z = -0.9 + viento * 0.85 + Math.sin(reloj * 14 + i * 2) * 0.15 * (0.3 + viento)));
  k.cola.rotation.z = Math.sin(reloj * 5) * 0.08 - viento * 0.3;
  k.giro.position.y = 0.55 + (j.enSuelo ? Math.abs(Math.sin(j.fase)) * 0.06 * amp : 0);

  // voltereta al saltar
  if (!j.enSuelo && j.volteo > 0) k.giro.rotation.z -= dt * 11;
  else k.giro.rotation.z *= Math.max(0, 1 - dt * 18);

  for (const c of cristales) if (c.visible) {
    c.rotation.y += dt * 2.5;
    c.position.y = c.userData.y + Math.sin(reloj * 3 + c.position.x) * 0.12;
  }

  // cámara lateral con anticipación según velocidad
  const vx = j.enSuelo ? tangente(j.n).x * j.gsp : j.vel.x;
  const ade = THREE.MathUtils.clamp(vx * 0.35, -7, 7);
  _foco.set(j.pos.x + ade, j.pos.y + 1.6, 0);
  const lejos = camara.aspect < 1 ? 17 : 19;
  camara.position.lerp(new THREE.Vector3(_foco.x, _foco.y + 2.2, lejos), Math.min(1, dt * 4));
  camara.lookAt(camara.position.x, camara.position.y - 2.2, 0);
  sol.position.set(j.pos.x - 20, j.pos.y + 40, 30);
  sol.target.position.set(j.pos.x, j.pos.y, 0);

  document.getElementById('cristales').textContent = juntados;
  document.getElementById('tiempo').textContent = formato(tiempo);
  document.getElementById('velocidad').textContent = Math.round(rapidez * 3.6);
  render.render(escena, camara);
}

const formato = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

// ------------------------------------------------------------ ciclo
let anterior = performance.now(), reloj = 0;
function ciclo(ahora) {
  const dt = Math.min(0.05, (ahora - anterior) / 1000);
  anterior = ahora;
  reloj += dt;
  if (jugando && !terminado) {
    tiempo += dt;
    const sub = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < sub; i++) paso(dt / sub);
  }
  dibujar(dt, reloj);
  requestAnimationFrame(ciclo);
}

function reiniciarJugador(x, y) {
  Object.assign(j, { gsp: 0, enSuelo: false, enLoop: false, loopHecho: false, z: 0, volteo: 0, mira: 1, xPrev: x });
  j.pos.set(x, y);
  j.vel.set(0, 0);
  j.n.set(0, 1);
}

function reiniciar() {
  reiniciarJugador(PUNTOS_REGRESO[0].x, PUNTOS_REGRESO[0].y);
  cristales.forEach((c) => (c.visible = true));
  juntados = 0;
  tiempo = 0;
  terminado = false;
  document.getElementById('fin').classList.add('oculto');
}

function terminar() {
  terminado = true;
  sonar.meta();
  const todos = juntados === total ? ' ¡Todos los cristales!' : '';
  document.getElementById('resumen').textContent =
    `Tiempo ${formato(tiempo)} · Cristales ${juntados} de ${total}.${todos}`;
  setTimeout(() => document.getElementById('fin').classList.remove('oculto'), 900);
}

// ------------------------------------------------------------ controles
const MAPA = {
  ArrowLeft: 'izq', KeyA: 'izq', ArrowRight: 'der', KeyD: 'der',
  Space: 'salto', ArrowUp: 'salto', KeyW: 'salto', ArrowDown: 'freno', KeyS: 'freno',
};
function pulsar(nombre, activo) {
  if (nombre === 'salto' && activo && !teclas.salto) saltoPedido = true;
  teclas[nombre] = activo;
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && jugando) return reiniciar();
  const n = MAPA[e.code];
  if (n) { e.preventDefault(); pulsar(n, true); }
});
addEventListener('keyup', (e) => { const n = MAPA[e.code]; if (n) pulsar(n, false); });
for (const b of document.querySelectorAll('#tactil button')) {
  const n = b.dataset.tecla;
  const on = (e) => { e.preventDefault(); b.classList.add('activo'); pulsar(n, true); };
  const off = (e) => { e.preventDefault(); b.classList.remove('activo'); pulsar(n, false); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('pointerleave', off);
}
if (matchMedia('(pointer: coarse)').matches) document.getElementById('tactil').classList.remove('oculto');

document.getElementById('jugar').addEventListener('click', () => {
  audio = audio || new AudioContext();
  document.getElementById('inicio').classList.add('oculto');
  reiniciar();
  jugando = true;
});
document.getElementById('otra').addEventListener('click', reiniciar);

// ------------------------------------------------------------ carga del nivel
const boton = document.getElementById('jugar');
boton.disabled = true;
new GLTFLoader().load('datos/nivel1.glb', (gltf) => {
  escena.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const nombre = o.name;
    o.receiveShadow = true;
    o.castShadow = !nombre.startsWith('SM_Fondo');
    if (/^SM_(Tramo_|Rampa|Puente_Tabla|Penasco|Meta_Apacheta|Llareta)/.test(nombre)) {
      o.material.side = THREE.FrontSide;
      if (!o.geometry.boundsTree) o.geometry.computeBoundsTree();
      suelo.push(o);
    } else if (nombre === 'SM_Loop') {
      o.material.side = THREE.FrontSide;
      o.geometry.computeBoundsTree();
      mallaLoop = o;
    } else if (nombre.startsWith('SM_Cristal')) {
      o.castShadow = false;
      o.userData.y = o.position.y;
      cristales.push(o);
    }
  });
  total = cristales.length;
  document.getElementById('total').textContent = total;
  document.getElementById('cargando').remove();
  boton.disabled = false;
  reiniciarJugador(PUNTOS_REGRESO[0].x, PUNTOS_REGRESO[0].y);
}, undefined, (err) => {
  document.getElementById('cargando').textContent = 'No se pudo cargar el nivel: ' + err.message;
});

window.kallpa = { j, teclas, F, paso, dibujar, cristales, estado: () => ({ juntados, total, terminado, tiempo }) };  // para depurar desde la consola
requestAnimationFrame(ciclo);

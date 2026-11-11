// Kallpa · Montaña de Colores — plataformero de velocidad 2.5D.
// Los niveles (datos/nivelN.glb + niveles.json) salen de generador_nivel.py; Blender X→X, Z→Y, Y→-Z.
// El jugador corre en el plano z≈0 y sigue la superficie (suelo, rampas, loop).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { crearMusica } from './musica.js';

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
  PLANEO: 0.3,  // gravedad que queda al planear con la chalina
  CAIDA_PLANEO: 3.5,
};
const CARRIL = 1.6;        // medio desvío lateral de la hélice del loop
const VUELO_CONDOR = 3.2;  // segundos que dura el viaje en cóndor
// datos del nivel actual (de datos/niveles.json, que escribe generador_nivel.py)
let niveles = [], nivel = null;
const $ = (id) => document.getElementById(id);

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
let audio = null, salida = null, musica = null;
let silencio = false;
try { silencio = localStorage.getItem('kallpa_silencio') === '1'; } catch { /* sin almacenamiento */ }
function iniciarAudio() {
  if (audio) return;
  audio = new AudioContext();
  salida = audio.createGain();
  salida.gain.value = silencio ? 0 : 1;
  salida.connect(audio.destination);
  musica = crearMusica(audio, salida);
}
function alternarSonido() {
  silencio = !silencio;
  if (salida) salida.gain.value = silencio ? 0 : 1;
  try { localStorage.setItem('kallpa_silencio', silencio ? '1' : '0'); } catch { /* sin almacenamiento */ }
  pintarSonido();
}
function pintarSonido() {
  for (const b of document.querySelectorAll('.sonido')) b.textContent = silencio ? '🔇' : '🔊';
}
function tono(frec, dur, tipo = 'square', vol = 0.12, desliz = 0) {
  if (!audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(frec, t);
  if (desliz) o.frequency.exponentialRampToValueAtTime(frec * desliz, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(salida);
  o.start(t);
  o.stop(t + dur);
}
const sonar = {
  salto: () => tono(330, 0.18, 'square', 0.08, 2),
  cristal: () => { tono(1320, 0.08, 'triangle', 0.1); setTimeout(() => tono(1760, 0.12, 'triangle', 0.1), 60); },
  quipu: () => [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => tono(f, 0.18, 'triangle', 0.12), i * 70)),
  rebote: () => tono(180, 0.35, 'sine', 0.2, 4),
  caida: () => tono(400, 0.6, 'sawtooth', 0.08, 0.2),
  pisoton: () => { tono(260, 0.1, 'square', 0.12, 0.5); setTimeout(() => tono(880, 0.14, 'triangle', 0.1, 1.5), 50); },
  golpe: () => tono(200, 0.45, 'sawtooth', 0.12, 0.4),
  condor: () => { tono(520, 0.5, 'sawtooth', 0.05, 1.6); setTimeout(() => tono(700, 0.6, 'sine', 0.08, 0.6), 200); },
  lava: () => tono(90, 0.5, 'sawtooth', 0.08, 0.5),
  jefe: () => [196, 185, 175, 165].forEach((f, i) => setTimeout(() => tono(f, 0.3, 'sawtooth', 0.1), i * 160)),
  meta: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tono(f, 0.25, 'triangle', 0.12), i * 120)),
};

// ------------------------------------------------------------ modelos
const mate = (c, r = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });
const ESFERA = new THREE.SphereGeometry(1, 20, 14);
function pieza(geo, m, x, y, z, sx = 1, sy = sx, sz = sx) {
  const p = new THREE.Mesh(geo, m);
  p.position.set(x, y, z);
  p.scale.set(sx, sy, sz);
  p.castShadow = true;
  return p;
}

// Kallpa (personaje original): vizcacha chaski azul con chalina y ojotas.
// Con fantasma=true sale translúcida y sin sombra (la carrera récord).
function crearKallpa(fantasma = false) {
  const raiz = new THREE.Group();         // se alinea con la normal del suelo
  const espejo = new THREE.Group();       // scale.x = ±1 según hacia dónde mira
  const giro = new THREE.Group();         // voltereta del salto, pivote en el torso
  giro.position.y = 0.55;
  raiz.add(espejo);
  espejo.add(giro);
  espejo.scale.setScalar(1.45);

  const mat = fantasma
    ? (c, r) => mate(c, r, { transparent: true, opacity: 0.35, depthWrite: false })
    : mate;
  const mats = {
    pelaje: mat(0x2f6bd8), panza: mat(0xf1e4cc), oscuro: mat(0x1d2a4a, 0.5),
    rosado: mat(0xe8a0a0), ojota: mat(0x7a4a25, 0.7), chalina: mat(0xc2264f, 0.9), franja: mat(0xf2b134, 0.9),
  };
  const { pelaje, panza, oscuro, rosado, ojota, chalina, franja } = mats;
  const esfera = ESFERA;

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
  if (fantasma) raiz.traverse((o) => { o.castShadow = false; o.renderOrder = 2; });
  return { raiz, espejo, giro, orejas, puntas, cola, patas, brazos, mats };
}
const kallpa = crearKallpa();
escena.add(kallpa.raiz);
const fantasma = crearKallpa(true);
fantasma.raiz.visible = false;
escena.add(fantasma.raiz);

// Animación compartida por Kallpa y su fantasma
function posar(k, e, dt, reloj) {
  k.raiz.position.set(e.x, e.y, e.z);
  k.raiz.rotation.z = e.ang;
  k.espejo.scale.x += (e.mira * 1.45 - k.espejo.scale.x) * Math.min(1, dt * 14);
  const amp = e.suelo ? Math.min(1.1, e.rapidez / 8) : 0.25;
  k.patas.forEach((p, i) => (p.rotation.z = Math.sin(e.fase + i * Math.PI) * amp));
  const brazo = e.planea ? -2.2 : 0;
  k.brazos.forEach((b, i) => (b.rotation.z = brazo - Math.sin(e.fase + i * Math.PI) * amp * 0.8));
  const viento = e.planea ? 1 : Math.min(1, e.rapidez / F.TOP);
  k.orejas.forEach((o, i) => (o.rotation.z = 0.25 + viento * 0.9 + Math.sin(reloj * 9 + i) * 0.05));
  // planeando, las puntas de la chalina se estiran hacia atrás y arriba como una cometa
  k.puntas.forEach((p, i) => {
    if (e.planea) {
      p.rotation.z = -1.0 - i * 0.35 + Math.sin(reloj * 12 + i * 2) * 0.12;
      p.scale.set(3.2, 3, 1);
    } else {
      p.rotation.z = -0.9 + viento * 0.85 + Math.sin(reloj * 14 + i * 2) * 0.15 * (0.3 + viento);
      p.scale.set(1, 1, 1);
    }
  });
  k.cola.rotation.z = Math.sin(reloj * 5) * 0.08 - viento * 0.3;
  k.giro.position.y = 0.55 + (e.suelo ? Math.abs(Math.sin(e.fase)) * 0.06 * amp : 0);
  k.giro.rotation.z = e.giro;
}

// ------------------------------------------------------------ trajes (se desbloquean con quipus)
const TRAJES = [
  { nombre: 'Chalina roja', quipus: 0, chalina: 0xc2264f, franja: 0xf2b134, pelaje: 0x2f6bd8 },
  { nombre: 'Chalina de quebrada', quipus: 3, chalina: 0x2f9e5a, franja: 0xf4e7c5, pelaje: 0x2f6bd8 },
  { nombre: 'Chalina morada', quipus: 6, chalina: 0x6b3fa0, franja: 0x6fd3c8, pelaje: 0x2f6bd8 },
  { nombre: 'Chalina dorada', quipus: 10, chalina: 0xd9a521, franja: 0xc2264f, pelaje: 0x2f6bd8 },
  { nombre: 'Kallpa nevada', quipus: 14, chalina: 0x2d7fd6, franja: 0xffffff, pelaje: 0xdfe8f5 },
  { nombre: 'Noche andina', quipus: 18, chalina: 0xf2b134, franja: 0x6fd3c8, pelaje: 0x1f2a6b },
];
function vestir(i) {
  const t = TRAJES[i] || TRAJES[0];
  kallpa.mats.chalina.color.set(t.chalina);
  kallpa.mats.franja.color.set(t.franja);
  kallpa.mats.pelaje.color.set(t.pelaje);
}

// ------------------------------------------------------------ enemigos (originales)
// Pirquincho: bicho con caparazón de piedra que patrulla de ida y vuelta.
// Moscardón: insecto peludo que vuela a la altura de la cabeza.
const M_ENE = {
  piedra: mate(0x7d6b5a, 0.95), veta: mate(0xc9a36b, 0.9), cara: mate(0x4a3528, 0.8),
  blanco: mate(0xfff6e6, 0.4), negro: mate(0x141010, 0.4), cuerno: mate(0xe8dcc0, 0.6),
  amarillo: mate(0xf2b51c, 0.7), rojo: mate(0xd8322a, 0.3), oro: mate(0xf0b22a, 0.3, { metalness: 0.7 }),
  ala: mate(0xe8f2ff, 0.2, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
};
function ojosEnojados(grupo, x, y, sep, tam) {
  for (const z of [-sep, sep]) {
    grupo.add(pieza(ESFERA, M_ENE.blanco, x, y, z, tam));
    grupo.add(pieza(ESFERA, M_ENE.negro, x + tam * 0.6, y - tam * 0.1, z, tam * 0.5));
    const ceja = pieza(new THREE.BoxGeometry(tam * 2.2, tam * 0.45, tam * 0.6), M_ENE.negro, x + tam * 0.3, y + tam * 1.05, z);
    ceja.rotation.x = z < 0 ? -0.5 : 0.5;  // cejas en V
    ceja.rotation.z = -0.15;
    grupo.add(ceja);
  }
}
function crearPirquincho(veta = M_ENE.veta) {
  const raiz = new THREE.Group(), espejo = new THREE.Group();
  raiz.add(espejo);
  const casco = new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  espejo.add(pieza(casco, M_ENE.piedra, 0, 0.22, 0, 1.15, 0.95, 0.95));
  for (const [y, r] of [[0.32, 0.66], [0.55, 0.5]]) {
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 24), veta);
    anillo.position.y = y;
    anillo.rotation.x = Math.PI / 2;
    anillo.scale.set(1.15, 0.95, 1);
    espejo.add(anillo);
  }
  const cabeza = new THREE.Group();
  cabeza.position.set(0.68, 0.3, 0);
  espejo.add(cabeza);
  cabeza.add(pieza(ESFERA, M_ENE.cara, 0, 0, 0, 0.26, 0.22, 0.24));
  ojosEnojados(cabeza, 0.14, 0.06, 0.1, 0.075);
  for (const z of [-0.13, 0.13]) {
    const c = pieza(new THREE.ConeGeometry(0.05, 0.22, 6), M_ENE.cuerno, 0.02, 0.24, z);
    c.rotation.z = -0.5;
    cabeza.add(c);
  }
  const patas = [];
  for (const [x, z] of [[0.35, -0.35], [0.35, 0.35], [-0.35, -0.35], [-0.35, 0.35]]) {
    const p = pieza(new THREE.CapsuleGeometry(0.07, 0.12, 4, 6), M_ENE.cara, x, 0.1, z);
    espejo.add(p);
    patas.push(p);
  }
  return { raiz, espejo, patas, r: 0.65, alto: 0.4 };
}
function crearMoscardon() {
  const raiz = new THREE.Group(), espejo = new THREE.Group();
  raiz.add(espejo);
  espejo.add(pieza(ESFERA, M_ENE.amarillo, 0, 0, 0, 0.42, 0.32, 0.32));
  for (const x of [-0.14, 0.1]) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 18), M_ENE.negro);
    f.position.x = x;
    f.rotation.y = Math.PI / 2;
    f.scale.setScalar(1 - Math.abs(x) * 0.8);
    espejo.add(f);
  }
  espejo.add(pieza(ESFERA, M_ENE.negro, 0.42, 0.04, 0, 0.2));
  for (const z of [-0.1, 0.1]) espejo.add(pieza(ESFERA, M_ENE.rojo, 0.55, 0.09, z, 0.08));
  const aguijon = pieza(new THREE.ConeGeometry(0.06, 0.25, 6), M_ENE.negro, -0.5, -0.02, 0);
  aguijon.rotation.z = Math.PI / 2;
  espejo.add(aguijon);
  const alas = [];
  for (const z of [-1, 1]) {
    const pivote = new THREE.Group();
    pivote.position.set(0.05, 0.25, z * 0.08);
    const ala = new THREE.Mesh(new THREE.CircleGeometry(0.32, 12), M_ENE.ala);
    ala.scale.set(1, 0.55, 1);
    ala.rotation.x = Math.PI / 2;
    ala.position.set(-0.08, 0, z * 0.3);
    pivote.add(ala);
    espejo.add(pivote);
    alas.push(pivote);
  }
  return { raiz, espejo, alas, r: 0.5, alto: 0 };
}

const grupoEnemigos = new THREE.Group();
escena.add(grupoEnemigos);
let enemigos = [];
const particulas = [];

function crearEnemigos(datos) {
  grupoEnemigos.clear();
  enemigos = datos.map((d) => {
    const m = d.tipo === 'volador' ? crearMoscardon() : crearPirquincho();
    grupoEnemigos.add(m.raiz);
    return { ...m, tipo: d.tipo, x0: d.x, y0: d.y, rango: d.rango, x: d.x, y: d.y, dir: -1, fase: Math.random() * 6, vivo: true, muere: 0 };
  });
}
function reiniciarEnemigos() {
  for (const e of enemigos) {
    Object.assign(e, { x: e.x0, y: e.y0, dir: -1, vivo: true, muere: 0 });
    e.raiz.visible = true;
    e.raiz.scale.set(1, 1, 1);
    e.raiz.rotation.set(0, 0, 0);
  }
}

const rayoE = new THREE.Raycaster();
rayoE.firstHitOnly = true;
function alturaSuelo(x, y, z = 0, lejos = 4) {
  rayoE.set(_o.set(x, y, z), _d.set(0, -1, 0));
  rayoE.far = lejos;
  const h = rayoE.intersectObjects(suelo, false)[0];
  return h ? h.point.y : null;
}
function moverEnemigos(dt) {
  for (const e of enemigos) {
    if (!e.vivo) continue;
    e.fase += dt;
    if (e.tipo === 'volador') {
      e.x = e.x0 + Math.sin(e.fase * 0.9) * e.rango;
      e.y = e.y0 + Math.sin(e.fase * 2.2) * 0.5;
      e.dir = Math.cos(e.fase * 0.9) >= 0 ? 1 : -1;
    } else {
      e.x += e.dir * 1.8 * dt;
      if (Math.abs(e.x - e.x0) > e.rango) { e.x = e.x0 + Math.sign(e.x - e.x0) * e.rango; e.dir *= -1; }
      const h = alturaSuelo(e.x, e.y + 2);
      if (h !== null) e.y = h;
    }
  }
}

// Caer encima (en el aire y por sobre su centro) lo derrota; cualquier otro choque golpea a Kallpa.
const pisa = (dy, alto) => !j.enSuelo && ((j.vel.y < 0 && dy > 0.1) || dy > alto);
function chocarEnemigos(cx, cy) {
  for (const e of enemigos) {
    if (!e.vivo) continue;
    const dx = cx - e.x, dy = cy - (e.y + e.alto);
    if (dx * dx + dy * dy > (e.r + 0.55) ** 2) continue;
    if (pisa(dy, 0.45)) {
      derrotar(e);
      j.vel.y = teclas.salto ? 15 : 10.5;
      j.volteo = 1;
    } else golpear(dx);
  }
}

// Golpe a Kallpa: +3 s, sale rebotada y queda invulnerable un rato.
function golpear(dx) {
  if (j.invul > 0) return;
  j.invul = 1.6;
  tiempo += 3;
  golpes++;
  avisar('+3 s');
  sonar.golpe();
  j.volteo = 0;
  j.enLoop = false;
  despegar(new THREE.Vector2((Math.sign(dx) || -j.mira) * 9, 8));
}

function estallido(x, y, mat, n = 8, fuerza = 4, tam = 0.12) {
  for (let i = 0; i < n; i++) {
    const p = pieza(ESFERA, mat, x, y, 0, tam);
    p.castShadow = false;
    const a = (i / n) * Math.PI * 2;
    p.userData = { v: new THREE.Vector3(Math.cos(a) * fuerza, Math.sin(a) * fuerza * 0.75 + 3, Math.sin(a * 3)), vida: 0.5, g: 20, tam: tam * 2.5 };
    escena.add(p);
    particulas.push(p);
  }
}

function derrotar(e) {
  e.vivo = false;
  e.muere = 0.5;
  derrotados++;
  sonar.pisoton();
  estallido(e.x, e.y + e.alto, M_ENE.cuerno);
}

function animarEnemigos(dt, reloj) {
  for (const e of enemigos) {
    e.raiz.position.set(e.x, e.y, 0);
    e.espejo.scale.x += (e.dir - e.espejo.scale.x) * Math.min(1, dt * 10);
    if (e.tipo === 'volador') e.alas.forEach((a, i) => (a.rotation.x = Math.sin(reloj * 45) * 0.7 * (i ? 1 : -1)));
    else e.patas.forEach((p, i) => (p.rotation.z = Math.sin(e.fase * 12 + i * Math.PI / 2) * 0.6));
    if (!e.vivo && e.muere > 0) {
      e.muere -= dt;
      if (e.tipo === 'volador') { e.raiz.rotation.z += dt * 14; e.y -= dt * 6; }
      else e.raiz.scale.set(1.25, Math.max(0.15, e.muere * 2), 1.25);  // aplastado
      if (e.muere <= 0) e.raiz.visible = false;
    }
  }
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i], u = p.userData;
    u.vida -= dt;
    u.v.y -= u.g * dt;
    p.position.addScaledVector(u.v, dt);
    p.scale.setScalar(Math.max(0.01, u.vida * u.tam));
    if (u.vida <= 0) { escena.remove(p); particulas.splice(i, 1); }
  }
}

// ------------------------------------------------------------ jefe: el Pirquincho Mayor (nivel 6)
// Hay que pisarlo tres veces; mientras siga en pie, una puerta de piedra tapa la apacheta.
const jefeM = crearPirquincho(M_ENE.oro);
jefeM.raiz.scale.setScalar(2.4);
{
  const corona = new THREE.Group();
  corona.position.set(0, 0.86, 0);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const p = pieza(new THREE.ConeGeometry(0.07, 0.3, 5), M_ENE.oro, Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3);
    corona.add(p);
  }
  corona.add(pieza(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 14), M_ENE.oro, 0, 0, 0));
  jefeM.espejo.add(corona);
}
const puerta = new THREE.Group();
{
  const piedra = mate(0x8a7a66, 0.95), sol_ = mate(0xf0b22a, 0.4, { emissive: 0xf08a1a, emissiveIntensity: 0.6 });
  for (let i = 0; i < 5; i++) puerta.add(pieza(new THREE.BoxGeometry(1.1, 1.3, 3.2), piedra, 0, 0.65 + i * 1.32, 0));
  const disco = pieza(new THREE.CylinderGeometry(0.8, 0.8, 0.15, 20), sol_, 0.6, 4, 0);
  disco.rotation.z = Math.PI / 2;
  puerta.add(disco);
}
const jefe = { activo: false, estado: 'espera', x: 0, y: 0, vy: 0, dir: -1, vidas: 3, inv: 0, salto: 2.5, muere: 0, fase: 0 };
function prepararJefe() {
  const d = nivel.jefe;
  jefe.activo = !!d;
  jefeM.raiz.visible = puerta.visible = !!d;
  $('jefe').classList.add('oculto');
  if (!d) return;
  Object.assign(jefe, { estado: 'espera', x: d[0] + 9, y: alturaSuelo(d[0] + 9, 10, 0, 30) ?? 0, vy: 0, dir: -1, vidas: 3, inv: 0, salto: 2.5, muere: 0 });
  jefeM.raiz.scale.setScalar(2.4);
  jefeM.raiz.rotation.set(0, 0, 0);
  puerta.position.set(d[1] + 0.8, alturaSuelo(d[1], 10, 0, 30) ?? 0, 0);
}
function pintarVidas() {
  $('jefe').innerHTML = `Pirquincho Mayor <b>${'♥'.repeat(jefe.vidas)}<span>${'♥'.repeat(3 - jefe.vidas)}</span></b>`;
}
function moverJefe(dt, cx, cy) {
  if (!jefe.activo) return;
  const d = nivel.jefe;
  if (jefe.estado === 'vencido') {
    puerta.position.y -= dt * 3;   // la puerta se hunde
    return;
  }
  // la puerta no deja pasar
  if (j.pos.x > d[1] - 0.2) {
    j.pos.x = d[1] - 0.2;
    j.gsp = Math.min(j.gsp, 0);
    j.vel.x = Math.min(j.vel.x, 0);
  }
  if (jefe.estado === 'espera') {
    if (j.pos.x < d[0]) return;
    jefe.estado = 'pelea';
    $('jefe').classList.remove('oculto');
    pintarVidas();
    avisar('¡El Pirquincho Mayor!');
    sonar.jefe();
    musica?.tocar('jefe');
  }
  jefe.fase += dt;
  jefe.inv = Math.max(0, jefe.inv - dt);
  // persigue a Kallpa; recién pisado, arranca hacia el otro lado
  const hacia = Math.sign(j.pos.x - jefe.x) || 1;
  jefe.dir = jefe.inv > 0 ? -hacia : hacia;
  const rapidez = jefe.inv > 0 ? 7 : 2.5 + (3 - jefe.vidas) * 1.5;
  jefe.x = THREE.MathUtils.clamp(jefe.x + jefe.dir * rapidez * dt, d[0] + 2, d[1] - 2.5);
  jefe.salto -= dt;
  const piso = alturaSuelo(jefe.x, jefe.y + 3, 0, 8) ?? jefe.y;
  if (jefe.salto <= 0 && jefe.y <= piso + 0.01) { jefe.vy = 12; jefe.salto = 3 - (3 - jefe.vidas) * 0.5; }
  jefe.vy -= F.G * dt;
  jefe.y += jefe.vy * dt;
  if (jefe.y <= piso) {
    if (jefe.vy < -8) sacudida = 0.4;
    jefe.y = piso;
    jefe.vy = 0;
  }
  // choque con Kallpa
  const r = 0.65 * 2.4, alto = 0.4 * 2.4;
  const dx = cx - jefe.x, dy = cy - (jefe.y + alto);
  if (dx * dx + dy * dy > (r + 0.55) ** 2) return;
  if (pisa(dy, 1.0)) {
    if (jefe.inv > 0) return;
    jefe.vidas--;
    jefe.inv = 1.5;
    j.vel.y = 16;
    j.volteo = 1;
    sonar.pisoton();
    estallido(jefe.x, jefe.y + alto * 2, M_ENE.oro, 10, 5);
    pintarVidas();
    if (jefe.vidas === 0) {
      jefe.estado = 'vencido';
      jefe.muere = 0.8;
      derrotados++;
      sacudida = 0.6;
      estallido(jefe.x, jefe.y + alto, M_ENE.piedra, 18, 7, 0.2);
      avisar('¡Camino libre!');
      sonar.meta();
      $('jefe').classList.add('oculto');
      musica?.tocar(nivel.id);
    }
  } else if (jefe.inv <= 0) golpear(dx);
}
function animarJefe(dt, reloj) {
  if (!jefe.activo) return;
  const m = jefeM;
  m.raiz.position.set(jefe.x, jefe.y, 0);
  m.espejo.scale.x += (jefe.dir - m.espejo.scale.x) * Math.min(1, dt * 8);
  m.patas.forEach((p, i) => (p.rotation.z = Math.sin(jefe.fase * 10 + i * Math.PI / 2) * 0.6));
  m.raiz.visible = jefe.estado !== 'vencido' || jefe.muere > 0;
  if (jefe.inv > 0 && jefe.estado !== 'vencido') m.raiz.visible = Math.floor(reloj * 14) % 2 === 0;
  if (jefe.estado === 'vencido' && jefe.muere > 0) {
    jefe.muere -= dt;
    m.raiz.scale.set(2.4 * 1.3, Math.max(0.2, jefe.muere * 3), 2.4 * 1.3);
  }
}

// ------------------------------------------------------------ cóndor (te cruza el primer cañón)
function crearCondor() {
  const raiz = new THREE.Group(), cuerpo = new THREE.Group();
  raiz.add(cuerpo);
  cuerpo.rotation.x = 0.35;   // inclinado hacia la cámara para que se vean las alas
  const negro = mate(0x16161a, 0.7), blanco = mate(0xf4f1ea, 0.8), piel = mate(0xb9867a, 0.6), pico = mate(0xe8dcc0, 0.5);
  cuerpo.add(pieza(ESFERA, negro, 0, 0, 0, 0.9, 0.42, 0.45));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.12, 8, 16), blanco);
  collar.position.set(0.72, 0.12, 0);
  collar.rotation.y = Math.PI / 2;
  cuerpo.add(collar);
  cuerpo.add(pieza(ESFERA, piel, 0.98, 0.2, 0, 0.2, 0.17, 0.16));
  const p = pieza(new THREE.ConeGeometry(0.07, 0.22, 6), pico, 1.18, 0.16, 0);
  p.rotation.z = -Math.PI / 2 - 0.5;
  cuerpo.add(p);
  for (const z of [-0.08, 0.08]) cuerpo.add(pieza(ESFERA, M_ENE.negro, 1.04, 0.27, z, 0.035));
  const cola = pieza(new THREE.BoxGeometry(0.7, 0.06, 0.5), negro, -1.05, 0, 0);
  cuerpo.add(cola);
  const alas = [];
  for (const s of [-1, 1]) {
    const pivote = new THREE.Group();
    pivote.position.set(0.1, 0.1, s * 0.35);
    const ala = pieza(new THREE.BoxGeometry(1.0, 0.06, 1.5), negro, 0, 0, s * 0.75);
    ala.add(pieza(new THREE.BoxGeometry(0.3, 0.07, 1.1), blanco, 0.2, 0.01, -s * 0.1));   // franja blanca
    for (let k = 0; k < 4; k++) {   // plumas abiertas en la punta
      const pl = pieza(new THREE.BoxGeometry(0.14, 0.05, 0.5), negro, 0.38 - k * 0.24, 0, s * 0.95);
      pl.rotation.y = s * (0.15 + k * 0.12);
      ala.add(pl);
    }
    pivote.add(ala);
    cuerpo.add(pivote);
    alas.push({ pivote, s });
  }
  raiz.scale.setScalar(1.2);
  return { raiz, alas };
}
const condorM = crearCondor();
escena.add(condorM.raiz);
const condor = { estado: 'espera', t: 0, pos: new THREE.Vector3() };
function puntoCondor(d, u, v) {
  // curva de Bézier cuadrática: percha → cielo → aterrizaje
  const a = (1 - u) ** 2, b = 2 * (1 - u) * u, c = u * u;
  return v.set(a * d.x + b * d.cx + c * d.x2, a * d.y + b * d.cy + c * d.y2, 0);
}
function prepararCondor() {
  Object.assign(condor, { estado: 'espera', t: 0 });
  condor.pos.set(nivel.condor.x, nivel.condor.y, 0);
  condorM.raiz.visible = true;
}
function moverCondor(dt, cx, cy) {
  const d = nivel.condor;
  if (condor.estado === 'espera') {
    condor.pos.set(d.x, d.y + Math.sin(reloj * 2) * 0.15, 0);
    if (j.invul <= 0 && (cx - d.x) ** 2 + (cy - d.y) ** 2 < 1.6 ** 2) {
      condor.estado = 'vuela';
      condor.t = 0;
      j.enLoop = false;
      j.enSuelo = false;
      j.volteo = 0;
      sonar.condor();
      avisar('¡Al vuelo!');
    }
  } else if (condor.estado === 'vuela') {
    condor.t += dt / VUELO_CONDOR;
    const u = THREE.MathUtils.smootherstep(Math.min(condor.t, 1), 0, 1);
    puntoCondor(d, u, condor.pos);
    j.pos.set(condor.pos.x, condor.pos.y - 1.9);
    j.mira = 1;
    if (condor.t >= 1) {
      condor.estado = 'seVa';
      despegar(new THREE.Vector2(10, 2));
    }
  } else if (condor.estado === 'seVa') {
    condor.pos.x += dt * 14;
    condor.pos.y += dt * 8;
    if (condor.pos.y > d.cima + 25) condorM.raiz.visible = false;
  }
}
function animarCondor(m, pos, reloj, vuela) {
  m.raiz.position.copy(pos);
  const aleteo = vuela ? Math.sin(reloj * 5) * 0.55 : Math.sin(reloj * 3) * 0.25 + 0.2;
  for (const { pivote, s } of m.alas) pivote.rotation.x = s * aleteo;
}

// ------------------------------------------------------------ quipus (3 escondidos por nivel)
function crearQuipu() {
  const g = new THREE.Group();
  const soga = mate(0xd8c08a, 0.9);
  const colores = [0xc2264f, 0xf2b134, 0x2f9e5a, 0xfff4e0, 0x2d7fd6, 0x7a4a25];
  const cuerda = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
  const principal = pieza(cuerda, soga, 0, 0.45, 0, 1, 1.1, 1);
  principal.rotation.z = Math.PI / 2;
  g.add(principal);
  colores.forEach((c, i) => {
    const m = mate(c, 0.8, { emissive: c, emissiveIntensity: 0.25 });
    const x = -0.45 + i * 0.18, largo = 0.55 + (i % 3) * 0.15;
    g.add(pieza(cuerda, m, x, 0.45 - largo / 2, 0, 1, largo, 1));
    for (let k = 0; k < 1 + (i % 3); k++) g.add(pieza(ESFERA, m, x, 0.3 - k * 0.16, 0, 0.065));   // nudos
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.18, depthWrite: false }));
  halo.position.y = 0.2;
  g.add(halo);
  return g;
}
let quipus = [], quipusRun = 0;
const grupoQuipus = new THREE.Group();
escena.add(grupoQuipus);
function prepararQuipus() {
  grupoQuipus.clear();
  quipus = nivel.quipus.map((q, i) => {
    const m = crearQuipu();
    m.position.set(q.x, q.y, 0);
    m.userData = { i, y: q.y };
    grupoQuipus.add(m);
    return m;
  });
}
const quipusDe = (id) => progreso.quipus[id] || [];
const totalQuipus = () => Object.values(progreso.quipus).reduce((s, l) => s + l.length, 0);
function juntarQuipu(q) {
  q.visible = false;
  quipusRun++;
  sonar.quipu();
  const antes = totalQuipus();
  const lista = quipusDe(nivel.id);
  if (!lista.includes(q.userData.i)) progreso.quipus[nivel.id] = [...lista, q.userData.i];
  guardarProgreso();
  const nuevo = TRAJES.find((t) => t.quipus > antes && t.quipus <= totalQuipus());
  avisar(nuevo ? `¡Nuevo traje: ${nuevo.nombre}!` : '¡Quipu!');
}

// ------------------------------------------------------------ viento: corrientes y ráfagas
// Corrientes que suben por los cañones (planeando te elevan) y ráfagas laterales intermitentes.
const corrienteEn = (x, y) => nivel.corrientes.find((c) => Math.abs(x - c.x) < c.ancho / 2 && y < c.tope);
let rafagaAhora = 0;
function rafaga(x) {
  for (const [a, b] of nivel.rafagas) {
    if (x < a || x > b) continue;
    const c = tiempo % 5, n = Math.floor(tiempo / 5);
    return c > 1.2 && c < 3.8 ? (n % 2 ? -1 : 1) * 9 : 0;
  }
  return 0;
}
const M_VIENTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
const grupoViento = new THREE.Group();
escena.add(grupoViento);
const rachas = [];
for (let i = 0; i < 26; i++) {
  const r = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.04), M_VIENTO);
  r.userData = { dx: Math.random() * 30 - 15, dy: Math.random() * 8 - 1, z: Math.random() * 4 - 2, v: 0.8 + Math.random() * 0.6 };
  grupoViento.add(r);
  rachas.push(r);
}
const grupoCorrientes = new THREE.Group();
escena.add(grupoCorrientes);
function prepararCorrientes() {
  grupoCorrientes.clear();
  for (const c of nivel.corrientes) {
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.04), M_VIENTO);
      s.userData = { c, dx: (Math.random() - 0.5) * c.ancho, z: Math.random() * 3 - 1.5, f: Math.random(), v: 0.25 + Math.random() * 0.2 };
      grupoCorrientes.add(s);
    }
  }
}
function animarViento(dt) {
  rafagaAhora = jugando ? rafaga(j.pos.x) : 0;
  grupoViento.visible = rafagaAhora !== 0;
  if (grupoViento.visible) {
    for (const r of rachas) {
      const u = r.userData;
      u.dx += Math.sign(rafagaAhora) * u.v * 30 * dt;
      if (u.dx > 15) u.dx -= 30;
      if (u.dx < -15) u.dx += 30;
      r.position.set(j.pos.x + u.dx, j.pos.y + u.dy, u.z);
    }
  }
  for (const s of grupoCorrientes.children) {
    const u = s.userData, base = -12;
    u.f = (u.f + dt * u.v) % 1;
    s.position.set(u.c.x + u.dx, base + (u.c.tope - base) * u.f, u.z);
  }
}

// ------------------------------------------------------------ volcán: fumarolas y lava
const M_LAVA = mate(0xff5a1a, 0.6, { emissive: 0xff3d00, emissiveIntensity: 1.2 });
const M_CENIZA = mate(0x2a2220, 0.95);
const grupoFumarolas = new THREE.Group();
escena.add(grupoFumarolas);
const lagoLava = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M_LAVA);
lagoLava.rotation.x = -Math.PI / 2;
lagoLava.receiveShadow = false;
escena.add(lagoLava);
const COTA_LAVA = -9;
let fumarolas = [];
function prepararVolcan() {
  grupoFumarolas.clear();
  lagoLava.visible = nivel.lava;
  if (nivel.lava) {
    lagoLava.scale.set(nivel.meta + 80, 40, 1);
    lagoLava.position.set(nivel.meta / 2, COTA_LAVA, 0);
  }
  fumarolas = nivel.fumarolas.map((f) => {
    const g = new THREE.Group();
    g.position.set(f.x, f.y, 0);
    g.add(pieza(new THREE.ConeGeometry(1.1, 0.6, 9), M_CENIZA, 0, 0.2, 0));
    const boca = pieza(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 10), M_LAVA, 0, 0.5, 0);
    const chorro = pieza(new THREE.CylinderGeometry(0.45, 0.65, 1, 10, 1, true), M_LAVA, 0, 0.5, 0);
    chorro.castShadow = false;
    g.add(boca, chorro);
    grupoFumarolas.add(g);
    return { ...f, g, boca, chorro };
  });
}
// 0 = dormida, 1 = burbujea (aviso), 2 = erupción
const faseFumarola = (f) => { const c = (tiempo + f.x * 0.37) % 3.2; return c < 1.6 ? 0 : c < 2.4 ? 1 : 2; };
function tocarFumarolas(cx, cy) {
  for (const f of fumarolas) {
    if (faseFumarola(f) === 2 && Math.abs(cx - f.x) < 0.9 && cy > f.y - 0.5 && cy < f.y + 5.2) golpear(cx - f.x);
  }
}
function animarFumarolas(reloj) {
  for (const f of fumarolas) {
    const e = faseFumarola(f);
    const alto = e === 2 ? 5 : e === 1 ? 0.3 + Math.abs(Math.sin(reloj * 20)) * 0.3 : 0.01;
    f.chorro.scale.set(1, alto, 1);
    f.chorro.position.y = 0.5 + alto / 2;
    f.boca.scale.setScalar(e === 1 ? 1.2 + Math.sin(reloj * 25) * 0.2 : 1);
  }
  M_LAVA.emissiveIntensity = 1.1 + Math.sin(reloj * 3) * 0.25;
}

// ------------------------------------------------------------ ambiente: nubes, llamas, flamencos, polvo
const grupoNubes = new THREE.Group(), grupoFauna = new THREE.Group();
escena.add(grupoNubes, grupoFauna);
const M_NUBE = mate(0xffffff, 1, { emissive: 0xffffff, emissiveIntensity: 0.35 });
for (let i = 0; i < 16; i++) {
  const n = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const b = pieza(ESFERA, M_NUBE, k * 2.2 - 4.4 + Math.random(), Math.random() * 1.2, Math.random() * 2,
      2 + Math.random() * 1.5, 1.2 + Math.random() * 0.6, 1.6);
    b.castShadow = false;
    n.add(b);
  }
  n.userData.v = 0.6 + Math.random() * 0.8;
  grupoNubes.add(n);
}
function prepararNubes() {
  const largo = nivel.meta + 80;
  grupoNubes.children.forEach((n, i) => {
    n.position.set(-40 + (i / 16) * largo + Math.random() * 10, 24 + Math.random() * 18, -45 - Math.random() * 50);
    n.scale.setScalar(0.8 + Math.random() * 0.8);
  });
  M_NUBE.color.set(nivel.lava ? 0x9a8f8c : 0xffffff);
  M_NUBE.emissive.set(nivel.lava ? 0x5a4a44 : 0xffffff);
}

function crearLlama() {
  const g = new THREE.Group();
  const lana = mate([0xf3ead8, 0x9a6a44, 0xffffff, 0x5a3b28][Math.floor(Math.random() * 4)], 1);
  const oscuro = mate(0x2a1c14, 0.6);
  g.add(pieza(ESFERA, lana, 0, 1.0, 0, 0.75, 0.42, 0.38));
  const cuello = new THREE.Group();
  cuello.position.set(0.55, 1.15, 0);
  g.add(cuello);
  cuello.add(pieza(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), lana, 0.05, 0.4, 0));
  const cabeza = new THREE.Group();
  cabeza.position.set(0.12, 0.85, 0);
  cuello.add(cabeza);
  cabeza.add(pieza(ESFERA, lana, 0.08, 0, 0, 0.26, 0.17, 0.16));
  for (const z of [-0.08, 0.08]) {
    cabeza.add(pieza(new THREE.ConeGeometry(0.05, 0.22, 5), lana, -0.05, 0.2, z));
    cabeza.add(pieza(ESFERA, oscuro, 0.16, 0.06, z * 1.3, 0.03));
  }
  // borla de lana de colores en la oreja
  cabeza.add(pieza(ESFERA, mate(0xc2264f, 0.9), -0.05, 0.3, 0.1, 0.06));
  for (const [x, z] of [[0.45, -0.2], [0.45, 0.2], [-0.45, -0.2], [-0.45, 0.2]]) {
    g.add(pieza(new THREE.CapsuleGeometry(0.07, 0.6, 4, 6), lana, x, 0.4, z));
  }
  g.add(pieza(ESFERA, lana, -0.75, 1.1, 0, 0.14));
  g.userData = { cuello, cabeza, t: Math.random() * 10 };
  g.scale.setScalar(1.1);
  return g;
}
function crearFlamenco() {
  const g = new THREE.Group();
  const rosa = mate(0xf29bb0, 0.8), pico = mate(0x1a1a1a, 0.5), pata = mate(0xe0708a, 0.7);
  g.add(pieza(ESFERA, rosa, 0, 1.25, 0, 0.42, 0.26, 0.24));
  g.add(pieza(new THREE.CapsuleGeometry(0.025, 1.0, 4, 6), pata, 0, 0.55, 0));
  const dobla = pieza(new THREE.CapsuleGeometry(0.025, 0.4, 4, 6), pata, -0.08, 0.95, 0.05);
  dobla.rotation.z = 1.2;
  g.add(dobla);
  const cuello = new THREE.Group();
  cuello.position.set(0.3, 1.35, 0);
  g.add(cuello);
  const c1 = pieza(new THREE.CapsuleGeometry(0.05, 0.5, 4, 6), rosa, 0.05, 0.25, 0);
  c1.rotation.z = -0.4;
  cuello.add(c1);
  const cabeza = new THREE.Group();
  cabeza.position.set(0.15, 0.55, 0);
  cuello.add(cabeza);
  cabeza.add(pieza(ESFERA, rosa, 0, 0, 0, 0.1));
  const pk = pieza(new THREE.ConeGeometry(0.04, 0.2, 5), pico, 0.12, -0.04, 0);
  pk.rotation.z = -2;
  cabeza.add(pk);
  g.userData = { cuello, cabeza, t: Math.random() * 10 };
  return g;
}
function prepararFauna() {
  grupoFauna.clear();
  const zonaLoop = (x) => nivel.loops.some((l) => Math.abs(x - l.cx) < l.r + 4);
  const salar = nivel.id === 2;
  for (const [x0, x1] of nivel.terreno) {
    for (let x = Math.max(x0, 0) + 10; x < x1 - 6; x += 22 + Math.random() * 18) {
      if (zonaLoop(x)) continue;
      const z = -2.1 - Math.random() * 0.6;
      const y = alturaSuelo(x, 30, z, 60);
      if (y === null) continue;
      const a = salar ? crearFlamenco() : crearLlama();
      a.position.set(x, y, z);
      a.rotation.y = Math.random() < 0.5 ? 0.3 : Math.PI - 0.3;
      grupoFauna.add(a);
    }
  }
}
function animarAmbiente(dt, reloj) {
  for (const n of grupoNubes.children) {
    n.position.x += n.userData.v * dt;
    if (nivel && n.position.x > nivel.meta + 50) n.position.x = -50;
  }
  for (const a of grupoFauna.children) {
    const u = a.userData;
    u.t += dt;
    // rumia y de vez en cuando baja la cabeza a pastar
    const pasta = Math.max(0, Math.sin(u.t * 0.4)) ** 4;
    u.cuello.rotation.z = -pasta * 1.1;
    u.cabeza.rotation.z = Math.sin(u.t * 6) * 0.05 + pasta * 0.6;
  }
}

const M_POLVO = mate(0xd8c3a0, 1, { transparent: true, opacity: 0.7, depthWrite: false });
let polvoHasta = 0;
function levantarPolvo(dt) {
  if (!j.enSuelo || Math.abs(j.gsp) < 9 || j.enLoop) return;
  polvoHasta -= dt;
  if (polvoHasta > 0) return;
  polvoHasta = 0.035;
  const p = pieza(ESFERA, M_POLVO, j.pos.x - Math.sign(j.gsp) * 0.4, j.pos.y + 0.1, j.z + (Math.random() - 0.5) * 0.4, 0.1);
  p.castShadow = false;
  p.userData = { v: new THREE.Vector3(-Math.sign(j.gsp) * (1 + Math.random() * 2), 1 + Math.random(), 0), vida: 0.45, g: 2, tam: 0.6 };
  escena.add(p);
  particulas.push(p);
}

let avisoHasta = 0;
function avisar(texto) {
  const el = $('aviso');
  el.textContent = texto;
  el.classList.remove('oculto');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(avisoHasta);
  avisoHasta = setTimeout(() => el.classList.add('oculto'), 1100);
}

// ------------------------------------------------------------ estado
const j = {
  pos: new THREE.Vector2(), vel: new THREE.Vector2(), n: new THREE.Vector2(0, 1),
  gsp: 0, enSuelo: false, mira: 1, fase: 0, volteo: 0, angulo: 0, giro: 0, planea: false,
  z: 0, enLoop: false, loopHecho: false, loopIdx: -1, t: 0, xPrev: 0, invul: 0,
};
let derrotados = 0, golpes = 0, sacudida = 0;
let escenaNivel = null, suelo = [], mallasLoop = [], cristales = [], total = 0;
let juntados = 0, tiempo = 0, jugando = false, terminado = false, pausado = false;
let reloj = 0;

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
const colisiones = () => (j.enLoop ? [...suelo, mallasLoop[j.loopIdx]] : suelo);
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
  if (!j.enLoop) j.gsp += rafaga(j.pos.x) * t.x * dt;
  // en el glaciar se acelera y frena peor: el hielo resbala
  const hielo = nivel.hielo;
  const ACC = hielo ? F.ACC * 0.6 : F.ACC, DEC = hielo ? F.DEC * 0.3 : F.DEC, FRIC = hielo ? F.FRIC * 0.15 : F.FRIC;

  const dir = (teclas.der ? 1 : 0) - (teclas.izq ? 1 : 0);
  if (teclas.freno) {
    j.gsp -= Math.sign(j.gsp) * Math.min(Math.abs(j.gsp), DEC * dt);
  } else if (dir !== 0) {
    if (j.gsp * dir < 0) j.gsp += dir * DEC * dt;
    else if (Math.abs(j.gsp) < F.TOP) j.gsp = dir * Math.min(F.TOP, Math.abs(j.gsp) + ACC * dt);
    j.mira = dir;
  }
  if (dir === 0 || Math.abs(j.gsp) > F.TOP) {
    // sin teclas frena; sobre la máxima pierde de a poco el impulso extra
    const fr = dir === 0 ? FRIC : F.FRIC * 0.4;
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
  // fuera del loop solo se corre por pendientes de menos de 60°: en bordes de peñascos se cae
  if (!j.enLoop && j.n.y < 0.5) return despegar(t.multiplyScalar(j.gsp));
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
  // con el salto apretado mientras cae, Kallpa abre la chalina y planea;
  // sobre un cañón la corriente de aire la sube
  const c = corrienteEn(j.pos.x, j.pos.y);
  j.planea = teclas.salto && (j.vel.y < 0 || !!c);
  if (j.planea) j.volteo = 0;
  const sube = j.planea && c;
  j.vel.y += (-F.G * (j.planea ? F.PLANEO : 1) + (sube ? 40 : 0)) * dt;
  if (j.planea && !sube) j.vel.y = Math.max(j.vel.y, -F.CAIDA_PLANEO);
  if (sube) j.vel.y = Math.min(j.vel.y, 9);
  j.vel.x += rafaga(j.pos.x) * dt;

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
      j.planea = false;
    }
  }
  saltoPedido = false;
}

// El loop es una hélice: entra por z=+1.6 y sale por z=-1.6, así la pista no choca consigo misma.
function seguirLoop(dt) {
  if (!j.enLoop) {
    const i = nivel.loops.findIndex((l) => j.pos.x > l.cx - 12 && j.pos.x < l.cx + 13);
    if (i !== j.loopIdx) { j.loopIdx = i; j.loopHecho = false; }
  }
  const L = nivel.loops[j.loopIdx];
  if (L && !j.enLoop && !j.loopHecho && j.enSuelo && j.gsp > 0 && j.xPrev < L.cx && j.pos.x >= L.cx && j.pos.y < 0.6) {
    j.enLoop = true;
    j.t = 0;
  }
  if (j.enLoop) {
    const crudo = Math.atan2(j.pos.x - L.cx, L.r + 0.08 - j.pos.y);
    let d = crudo - j.t;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    j.t += d;
    if (j.t >= 2 * Math.PI - 0.1) { j.enLoop = false; j.loopHecho = true; }
    else if (j.t < -0.1) { j.enLoop = false; }
    else j.z = CARRIL * (1 - 2 * THREE.MathUtils.clamp(j.t / (2 * Math.PI), 0, 1));
  }
  if (!j.enLoop) {
    let meta = 0;
    if (L && !j.loopHecho && j.pos.x > L.cx - 9 && j.pos.x < L.cx + 0.5) {
      meta = CARRIL * THREE.MathUtils.smoothstep(j.pos.x, L.cx - 9, L.cx - 1);
    }
    j.z += THREE.MathUtils.clamp(meta - j.z, -3 * dt, 3 * dt);
  }
  j.xPrev = j.pos.x;
}

function paso(dt) {
  const cx0 = j.pos.x + j.n.x * 0.6, cy0 = j.pos.y + j.n.y * 0.6;
  moverCondor(dt, cx0, cy0);
  if (condor.estado === 'vuela') {
    j.z += THREE.MathUtils.clamp(-j.z, -3 * dt, 3 * dt);
    j.planea = false;
  } else {
    if (j.enSuelo) pasoSuelo(dt); else pasoAire(dt);
    seguirLoop(dt);
  }
  moverEnemigos(dt);
  j.invul = j.invul > dt ? j.invul - dt : 0;

  const fondo = nivel.lava ? COTA_LAVA - 0.5 : -16;
  if (j.pos.y < fondo) {
    if (nivel.lava) sonar.lava(); else sonar.caida();
    const p = nivel.regresos.filter((q) => q.x <= j.pos.x).pop() || nivel.regresos[0];
    reiniciarJugador(p.x, p.y);
  }
  // cristales y quipus
  const cx = j.pos.x + j.n.x * 0.6, cy = j.pos.y + j.n.y * 0.6;
  for (const c of cristales) {
    if (!c.visible) continue;
    if ((c.position.x - cx) ** 2 + (c.position.y - cy) ** 2 < 1.3) {
      c.visible = false;
      juntados++;
      sonar.cristal();
    }
  }
  for (const q of quipus) {
    if (q.visible && (q.position.x - cx) ** 2 + (q.position.y + 0.2 - cy) ** 2 < 1.6) juntarQuipu(q);
  }
  if (condor.estado !== 'vuela') {
    chocarEnemigos(cx, cy);
    tocarFumarolas(cx, cy);
  }
  moverJefe(dt, cx, cy);
  if (!terminado && j.pos.x > nivel.meta) terminar();
}

// ------------------------------------------------------------ carrera fantasma (récord por nivel)
const FPS_FANTASMA = 30;
let grabacion = [], cinta = null;
const claveFantasma = (id) => `kallpa_fantasma_v1_${id}`;
function cuadro() {
  const r = (v) => Math.round(v * 100) / 100;
  return [r(j.pos.x), r(j.pos.y), r(j.z), r(j.angulo), j.mira, r(j.fase), r(j.giro), j.planea ? 1 : 0, j.enSuelo ? 1 : 0];
}
function grabar() {
  while (grabacion.length <= tiempo * FPS_FANTASMA) grabacion.push(cuadro());
}
function cargarCinta(id) {
  try { cinta = JSON.parse(localStorage.getItem(claveFantasma(id)) || 'null'); } catch { cinta = null; }
}
function guardarCinta(id) {
  cinta = grabacion;
  try { localStorage.setItem(claveFantasma(id), JSON.stringify(grabacion)); } catch { /* sin espacio */ }
}
function animarFantasma(dt, reloj) {
  const i = Math.floor(tiempo * FPS_FANTASMA);
  fantasma.raiz.visible = !!cinta && jugando && !cine && i < cinta.length;
  if (!fantasma.raiz.visible) return;
  const [x, y, z, ang, mira, fase_, giro, planea, suelo_] = cinta[i];
  posar(fantasma, { x, y, z, ang, mira, fase: fase_, giro, planea: !!planea, suelo: !!suelo_, rapidez: suelo_ ? 20 : 10 }, dt, reloj);
}

// ------------------------------------------------------------ historia de entrada (se puede saltar)
const HISTORIA = [
  'En lo alto de los Andes, las noticias viajan a pie, de apacheta en apacheta.',
  'Tayta Wayra, el cóndor más viejo, trae un quipu urgente: se viene una gran helada.',
  'Las comunidades del valle deben saberlo antes del anochecer. Y nadie corre como Kallpa.',
  '¡Corre, Kallpa!',
];
const DUR_CUADRO = 3.6;
const wayra = crearCondor();
wayra.raiz.visible = false;
escena.add(wayra.raiz);
const quipuCine = crearQuipu();
quipuCine.visible = false;
escena.add(quipuCine);
let cine = null;
function empezarHistoria() {
  cine = { t: 0, cuadro: -1 };
  $('historia').classList.remove('oculto');
  wayra.raiz.visible = true;
}
function terminarHistoria() {
  if (!cine) return;
  cine = null;
  $('historia').classList.add('oculto');
  wayra.raiz.visible = false;
  quipuCine.visible = false;
  progreso.historia = true;
  guardarProgreso();
  tiempo = 0;
  grabacion = [];
  jugando = true;
}
const _w = new THREE.Vector3();
function avanzarHistoria(dt) {
  cine.t += dt;
  const k = Math.min(HISTORIA.length - 1, Math.floor(cine.t / DUR_CUADRO));
  if (k !== cine.cuadro) {
    cine.cuadro = k;
    $('historia-texto').textContent = HISTORIA[k];
  }
  // el cóndor baja desde el cielo, suelta el quipu sobre Kallpa y se va
  const x0 = j.pos.x, y0 = j.pos.y, t = cine.t;
  if (t < 6) {
    const u = THREE.MathUtils.smootherstep(t, 0, 6);
    _w.set(x0 - 14 + u * 16.5, y0 + 14 - u * 10.5, 0);
  } else if (t < 10.5) {
    _w.set(x0 + 2.5, y0 + 3.5 + Math.sin(t * 2) * 0.2, 0);
  } else {
    _w.set(x0 + 2.5 + (t - 10.5) * 10, y0 + 3.5 + (t - 10.5) * 7, 0);
  }
  wayra.raiz.scale.x = t < 10.5 && t > 6 ? -1.2 : 1.2;   // mira a Kallpa mientras habla
  animarCondor(wayra, _w, reloj, t < 6 || t > 10.5);
  quipuCine.visible = t > 6.5 && t < 9.5;
  if (quipuCine.visible) {
    const u = THREE.MathUtils.clamp((t - 7.2) / 0.8, 0, 1);
    quipuCine.position.set(x0 + 2.5 - u * 2.3, y0 + 2.6 - u * 1.4, 0.2);
    quipuCine.rotation.y += dt * 2;
  }
  if (t > DUR_CUADRO * HISTORIA.length) terminarHistoria();
}

// ------------------------------------------------------------ dibujo
const _foco = new THREE.Vector3(), _cam = new THREE.Vector3();
function dibujar(dt, reloj) {
  const k = kallpa;
  k.raiz.visible = j.invul <= 0 || Math.floor(reloj * 16) % 2 === 0;  // parpadea tras un golpe
  animarEnemigos(dt, reloj);
  animarJefe(dt, reloj);
  if (nivel) {
    animarCondor(condorM, condor.pos, reloj, condor.estado !== 'espera');
    animarViento(dt);
    animarFumarolas(reloj);
  }
  animarAmbiente(dt, reloj);
  const objetivo = j.enSuelo ? Math.atan2(-j.n.x, j.n.y) : 0;
  let d = objetivo - j.angulo;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  j.angulo += d * Math.min(1, dt * (j.enSuelo ? 25 : 4));

  const rapidez = j.enSuelo ? Math.abs(j.gsp) : j.vel.length();
  if (j.enSuelo) j.fase += Math.abs(j.gsp) * dt * 1.6;
  // voltereta al saltar
  if (!j.enSuelo && j.volteo > 0) j.giro -= dt * 11;
  else j.giro = Math.atan2(Math.sin(j.giro), Math.cos(j.giro)) * Math.max(0, 1 - dt * 18);
  posar(k, { x: j.pos.x, y: j.pos.y, z: j.z, ang: j.angulo, mira: j.mira, fase: j.fase, giro: j.giro,
    planea: j.planea || condor.estado === 'vuela', suelo: j.enSuelo, rapidez }, dt, reloj);
  animarFantasma(dt, reloj);
  if (jugando && !pausado) levantarPolvo(dt);

  for (const c of cristales) if (c.visible) {
    c.rotation.y += dt * 2.5;
    c.position.y = c.userData.y + Math.sin(reloj * 3 + c.position.x) * 0.12;
  }
  for (const q of quipus) if (q.visible) {
    q.rotation.y += dt * 1.5;
    q.position.y = q.userData.y + Math.sin(reloj * 2) * 0.2;
  }

  // cámara lateral con anticipación según velocidad (en la historia, más cerca)
  const vx = j.enSuelo ? tangente(j.n).x * j.gsp : j.vel.x;
  const ade = cine ? 1.5 : THREE.MathUtils.clamp(vx * 0.35, -7, 7);
  _foco.set(j.pos.x + ade, j.pos.y + (cine ? 1.8 : 1.6), 0);
  const lejos = cine ? 11 : camara.aspect < 1 ? 17 : 19;
  camara.position.lerp(_cam.set(_foco.x, _foco.y + 2.2, lejos), Math.min(1, dt * 4));
  sacudida = Math.max(0, sacudida - dt);
  const temblor = sacudida * 0.6;
  camara.position.x += (Math.random() - 0.5) * temblor;
  camara.position.y += (Math.random() - 0.5) * temblor;
  camara.lookAt(camara.position.x, camara.position.y - 2.2, 0);
  sol.position.set(j.pos.x - 20, j.pos.y + 40, 30);
  sol.target.position.set(j.pos.x, j.pos.y, 0);

  $('cristales').textContent = juntados;
  $('derrotados').textContent = derrotados;
  $('quipus').textContent = quipusRun;
  $('tiempo').textContent = formato(tiempo);
  $('velocidad').textContent = Math.round(rapidez * 3.6);
  render.render(escena, camara);
}

const formato = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

// ------------------------------------------------------------ ciclo
// avanzar() es la lógica de un cuadro; los bots de prueba la llaman sin requestAnimationFrame.
function avanzar(dt) {
  reloj += dt;
  if (pausado) return;
  if (cine) return avanzarHistoria(dt);
  if (jugando && !terminado) {
    tiempo += dt;
    const sub = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < sub; i++) paso(dt / sub);
    grabar();
  }
}
let anterior = performance.now();
function ciclo(ahora) {
  const dt = Math.min(0.05, (ahora - anterior) / 1000);
  anterior = ahora;
  avanzar(dt);
  dibujar(pausado ? 0 : dt, reloj);
  requestAnimationFrame(ciclo);
}

function reiniciarJugador(x, y) {
  Object.assign(j, { gsp: 0, enSuelo: false, enLoop: false, loopHecho: false, loopIdx: -1, z: 0, volteo: 0, mira: 1, xPrev: x, invul: 1, planea: false });
  j.pos.set(x, y);
  j.vel.set(0, 0);
  j.n.set(0, 1);
}

function reiniciar() {
  reiniciarJugador(nivel.regresos[0].x, nivel.regresos[0].y);
  cristales.forEach((c) => (c.visible = true));
  quipus.forEach((q) => (q.visible = true));
  reiniciarEnemigos();
  prepararCondor();
  prepararJefe();
  juntados = 0;
  derrotados = 0;
  golpes = 0;
  quipusRun = 0;
  tiempo = 0;
  grabacion = [];
  terminado = false;
  pausar(false);
  mostrarTactil(true);
  $('fin').classList.add('oculto');
  musica?.tocar(nivel.id);
}

const MEDALLAS = [['oro', '🥇'], ['plata', '🥈'], ['bronce', '🥉']];
const medallaDe = (n, t) => n.medallas.findIndex((m) => t <= m);   // -1 = sin medalla

function terminar() {
  terminado = true;
  mostrarTactil(false);
  sonar.meta();
  const todos = juntados === total ? ' ¡Todos los cristales!' : '';
  const previo = progreso.marcas[nivel.id];
  const record = !previo || tiempo < previo.tiempo;
  if (record) guardarCinta(nivel.id);
  progreso.marcas[nivel.id] = {
    tiempo: record ? tiempo : previo.tiempo,
    cristales: Math.max(juntados, previo ? previo.cristales : 0),
  };
  progreso.abierto = Math.max(progreso.abierto, nivel.id + 1);
  guardarProgreso();
  const m = medallaDe(nivel, tiempo);
  $('medalla').textContent = m >= 0 ? MEDALLAS[m][1] : '🏁';
  const prox = m === 0 ? '' : ` · Para ${MEDALLAS[m < 0 ? 2 : m - 1][0]}: ${formato(nivel.medallas[m < 0 ? 2 : m - 1])}`;
  $('resumen').textContent =
    `${nivel.nombre} · Tiempo ${formato(tiempo)}${record ? ' (¡récord!)' : ''}${prox}` +
    ` · Cristales ${juntados} de ${total} · Enemigos ${derrotados} de ${enemigos.length + (jefe.activo ? 1 : 0)}` +
    ` · Quipus ${quipusDe(nivel.id).length} de 3.${todos}`;
  const sig = niveles.find((n) => n.id === nivel.id + 1);
  $('siguiente').classList.toggle('oculto', !sig);
  setTimeout(() => $('fin').classList.remove('oculto'), 900);
}

// ------------------------------------------------------------ progreso (solo en este navegador)
const CLAVE = 'kallpa_progreso_v1';
let progreso = { abierto: 1, marcas: {}, quipus: {}, traje: 0, historia: false };
try { progreso = { ...progreso, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch { /* sin almacenamiento */ }
function guardarProgreso() {
  try { localStorage.setItem(CLAVE, JSON.stringify(progreso)); } catch { /* sin almacenamiento */ }
}
vestir(progreso.traje);

// ------------------------------------------------------------ pausa
function pausar(si) {
  pausado = si;
  $('pausa').classList.toggle('oculto', !si);
  if (audio) si ? audio.suspend() : audio.resume();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && jugando && !terminado && !cine) pausar(true);
});

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
  if (cine) { if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') terminarHistoria(); return; }
  if ((e.code === 'Escape' || e.code === 'KeyP') && jugando && !terminado) return pausar(!pausado);
  if (e.code === 'KeyM') return alternarSonido();
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
// botones en pantalla solo con pantalla táctil y mientras se juega
const TACTIL = matchMedia('(pointer: coarse)').matches;
const mostrarTactil = (si) => $('tactil').classList.toggle('oculto', !(si && TACTIL));

$('otra').addEventListener('click', reiniciar);
$('siguiente').addEventListener('click', () => jugarNivel(nivel.id + 1));
$('menu').addEventListener('click', mostrarMenu);
$('boton-pausa').addEventListener('click', () => { if (jugando && !terminado) pausar(!pausado); });
$('seguir').addEventListener('click', () => pausar(false));
$('pausa-reiniciar').addEventListener('click', reiniciar);
$('pausa-menu').addEventListener('click', mostrarMenu);
$('saltar-historia').addEventListener('click', terminarHistoria);
$('ver-historia').addEventListener('click', () => { progreso.historia = false; jugarNivel(1); });
for (const b of document.querySelectorAll('.sonido')) b.addEventListener('click', alternarSonido);
pintarSonido();

// ------------------------------------------------------------ menú de niveles y trajes
function mostrarMenu() {
  jugando = false;
  cine = null;
  pausar(false);
  musica?.parar();
  $('fin').classList.add('oculto');
  $('historia').classList.add('oculto');
  $('jefe').classList.add('oculto');
  mostrarTactil(false);
  const lista = $('niveles');
  lista.replaceChildren();
  for (const n of niveles) {
    const b = document.createElement('button');
    const abierto = n.id <= progreso.abierto;
    const m = progreso.marcas[n.id];
    const med = m ? medallaDe(n, m.tiempo) : -1;
    b.className = 'nivel';
    b.disabled = !abierto;
    b.innerHTML = `<b>${n.id}. ${n.nombre}</b><small>${abierto ? n.sub : '🔒 Termina el nivel anterior'}</small>` +
      (m ? `<small class="marca">${med >= 0 ? MEDALLAS[med][1] + ' ' : ''}⏱ ${formato(m.tiempo)} · ◆ ${m.cristales}/${n.total} · 🪢 ${quipusDe(n.id).length}/3</small>` : '');
    b.addEventListener('click', () => jugarNivel(n.id));
    lista.append(b);
  }
  const tq = totalQuipus();
  $('quipus-total').textContent = `${tq} de ${niveles.length * 3}`;
  const trajes = $('trajes');
  trajes.replaceChildren();
  TRAJES.forEach((t, i) => {
    const b = document.createElement('button');
    const libre = tq >= t.quipus;
    b.className = 'traje' + (progreso.traje === i ? ' elegido' : '');
    b.disabled = !libre;
    b.title = libre ? t.nombre : `Junta ${t.quipus} quipus`;
    b.innerHTML = `<i style="background:#${t.pelaje.toString(16).padStart(6, '0')}"></i><i style="background:#${t.chalina.toString(16).padStart(6, '0')}"></i>` +
      `<span>${libre ? t.nombre : `🔒 ${t.quipus} 🪢`}</span>`;
    b.addEventListener('click', () => { progreso.traje = i; guardarProgreso(); vestir(i); mostrarMenu(); });
    trajes.append(b);
  });
  $('inicio').classList.remove('oculto');
}

async function jugarNivel(id) {
  iniciarAudio();
  $('inicio').classList.add('oculto');
  $('fin').classList.add('oculto');
  $('carga').classList.remove('oculto');
  jugando = false;
  cine = null;
  try {
    await cargarNivel(niveles.find((n) => n.id === id));
  } catch (err) {
    $('carga').textContent = 'No se pudo cargar el nivel: ' + err.message;
    return;
  }
  $('carga').classList.add('oculto');
  $('nombre-nivel').textContent = nivel.nombre;
  mostrarTactil(true);
  reiniciar();
  camara.position.set(j.pos.x, j.pos.y + 4, 19);
  if (id === 1 && !progreso.historia) {
    for (let i = 0; i < 120; i++) paso(1 / 120);   // que Kallpa quede parada en el suelo
    empezarHistoria();
  } else jugando = true;
}

// ------------------------------------------------------------ carga del nivel
const cargador = new GLTFLoader();
cargador.setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/'));
async function cargarNivel(datos) {
  const gltf = await cargador.loadAsync(datos.archivo);
  if (escenaNivel) {
    escena.remove(escenaNivel);
    escenaNivel.traverse((o) => {
      if (o.isMesh) {
        o.geometry.disposeBoundsTree?.();
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
  nivel = datos;
  escenaNivel = gltf.scene;
  suelo = [];
  mallasLoop = [];
  cristales.length = 0;
  escena.add(escenaNivel);
  escena.background = new THREE.Color(datos.cielo);
  escena.fog.color.set(datos.niebla);
  escenaNivel.updateMatrixWorld(true);
  // El exportador glTF puede compartir el índice entre mallas de igual topología (p. ej. dos loops)
  // y el BVH reordena el índice al construirse: se clona para que cada BVH tenga el suyo.
  const indices = new Set();
  const preparar = (g) => {
    if (g.boundsTree) return;
    if (g.index) {
      if (indices.has(g.index.array)) g.setIndex(g.index.clone());
      indices.add(g.index.array);
    }
    g.computeBoundsTree();
  };
  escenaNivel.traverse((o) => {
    if (!o.isMesh) return;
    const nombre = o.name;
    o.receiveShadow = true;
    o.castShadow = !nombre.startsWith('SM_Fondo');
    if (/^SM_(Tramo_|Rampa|Puente_Tabla|Penasco|Meta_Apacheta|Llareta)/.test(nombre)) {
      o.material.side = THREE.FrontSide;
      preparar(o.geometry);
      suelo.push(o);
    } else if (nombre.startsWith('SM_Loop_')) {
      o.material.side = THREE.FrontSide;
      preparar(o.geometry);
      mallasLoop[Number(nombre.slice(8))] = o;
    } else if (nombre.startsWith('SM_Cristal')) {
      o.castShadow = false;
      o.userData.y = o.position.y;
      cristales.push(o);
    }
  });
  total = cristales.length;
  $('total').textContent = total;
  crearEnemigos(datos.enemigos || []);
  $('enemigos').textContent = enemigos.length + (datos.jefe ? 1 : 0);
  escena.add(jefeM.raiz, puerta);
  prepararQuipus();
  prepararCorrientes();
  prepararVolcan();
  prepararNubes();
  prepararFauna();
  cargarCinta(datos.id);
}

fetch('datos/niveles.json').then((r) => r.json()).then((lista) => {
  niveles = lista;
  $('cargando').remove();
  mostrarMenu();
}).catch((err) => {
  $('cargando').textContent = 'No se pudo leer la lista de niveles: ' + err.message;
});

window.kallpa = {  // para depurar y para los bots de prueba desde la consola
  j, teclas, F, paso, avanzar, dibujar, cristales, jugarNivel, reiniciar, terminarHistoria,
  pulsar, pausar, condor, jefe, quipus: () => quipus, enemigos: () => enemigos, progreso: () => progreso,
  estado: () => ({ nivel: nivel?.id, juntados, total, terminado, tiempo, derrotados, golpes, quipusRun,
    enemigos: enemigos.length, cine: !!cine, pausado, jugando }),
};
requestAnimationFrame(ciclo);

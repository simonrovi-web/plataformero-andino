// Música andina sintetizada con Web Audio (sin archivos): zampoña, charango, bombo y chajchas.
// Cada nivel tiene su propio tema, generado con una semilla fija sobre la escala pentatónica.

const PENTA = [0, 3, 5, 7, 10];          // pentatónica menor
// tempo, nota base (MIDI) y semilla de cada nivel
const TEMAS = {
  1: { bpm: 148, base: 69, semilla: 11 },
  2: { bpm: 156, base: 71, semilla: 23 },
  3: { bpm: 140, base: 67, semilla: 37 },
  4: { bpm: 166, base: 64, semilla: 41 },
  5: { bpm: 126, base: 74, semilla: 53 },
  6: { bpm: 152, base: 69, semilla: 67 },
  jefe: { bpm: 178, base: 64, semilla: 79 },
};
// acordes por compás (grado de la escala menor natural): i, III, VII, i / i, VI, VII, i
const PROGRESION = [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]];
// figuras rítmicas de un pulso (en pulsos): el huayno alterna corchea y dos semicorcheas
const FIGURAS = [[0.5, 0.25, 0.25], [0.5, 0.25, 0.25], [0.25, 0.25, 0.5], [0.5, 0.5], [1]];

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function azar(semilla) {
  let s = semilla >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Melodía de 8 compases de 2/4 que termina en la tónica. Devuelve [{pulso, dur, grado|null}].
function frase(r, cierre) {
  const notas = [];
  let grado = 5 + Math.floor(r() * 3), pulso = 0;
  for (let compas = 0; compas < 8; compas++) {
    for (let p = 0; p < 2; p++) {
      if (compas === 7 && p === 1) break;
      const fig = FIGURAS[Math.floor(r() * FIGURAS.length)];
      for (const d of fig) {
        grado = Math.max(0, Math.min(9, grado + Math.round((r() - 0.5) * 3.2)));
        notas.push({ pulso, dur: d, grado: r() < 0.06 ? null : grado });
        pulso += d;
      }
    }
  }
  notas.push({ pulso, dur: 1, grado: cierre ? 0 : 5 });
  return notas;
}

function cancion(semilla) {
  const r = azar(semilla);
  const A = frase(r, true), B = frase(r, false);
  // forma A A B A (32 compases, 64 pulsos)
  return [A, A, B, A].flatMap((f, i) => f.map((n) => ({ ...n, pulso: n.pulso + i * 16 })));
}

export function crearMusica(ctx, salida) {
  const mezcla = ctx.createGain();
  mezcla.gain.value = 0.55;
  mezcla.connect(salida);

  const ruido = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const datos = ruido.getChannelData(0);
  for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;

  function soplo(t, dur, frec, vol) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = ruido;
    f.type = 'bandpass';
    f.frequency.value = frec;
    f.Q.value = 2;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    n.connect(f).connect(g).connect(mezcla);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur);
  }

  // zampoña: tubo soplado (seno + armónico suave), vibrato tardío y un poco de aire al atacar
  function zampona(t, dur, f) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), prof = ctx.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = f;
    o2.frequency.value = f * 2;
    lfo.frequency.value = 5.5;
    prof.gain.setValueAtTime(0, t);
    prof.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(dur, 0.35));
    lfo.connect(prof);
    prof.connect(o.frequency);
    prof.connect(o2.frequency);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    o2.connect(g2).connect(g);
    o.connect(g);
    g.connect(mezcla);
    const fin = t + Math.max(0.12, dur * 0.95);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.setValueAtTime(0.14, fin - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, fin + 0.06);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(fin + 0.08); }
    soplo(t, 0.09, f * 2, 0.05);
  }

  // charango: cuerdas pulsadas (diente de sierra filtrado que se apaga rápido), rasgueo escalonado
  function charango(t, frecs, vol) {
    frecs.forEach((f, i) => {
      const o = ctx.createOscillator(), filtro = ctx.createBiquadFilter(), g = ctx.createGain();
      const ti = t + i * 0.012;
      o.type = 'sawtooth';
      o.frequency.value = f;
      filtro.type = 'lowpass';
      filtro.frequency.setValueAtTime(3200, ti);
      filtro.frequency.exponentialRampToValueAtTime(700, ti + 0.25);
      g.gain.setValueAtTime(vol, ti);
      g.gain.exponentialRampToValueAtTime(0.0005, ti + 0.45);
      o.connect(filtro).connect(g).connect(mezcla);
      o.start(ti);
      o.stop(ti + 0.5);
    });
  }

  function bombo(t, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(g).connect(mezcla);
    o.start(t);
    o.stop(t + 0.32);
  }

  // chajchas: sonajero de pezuñas, ruido agudo muy corto
  function chajchas(t, vol) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = ruido;
    f.type = 'highpass';
    f.frequency.value = 6500;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    n.connect(f).connect(g).connect(mezcla);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.07);
  }

  let tema = null, notas = [], inicio = 0, hasta = 0, reloj = null;

  function programar() {
    if (!tema) return;
    const seg = 60 / tema.bpm, largo = 64;
    const limite = ctx.currentTime + 0.3;
    while (inicio + hasta * seg < limite) {
      const vuelta = Math.floor(hasta / largo), p = hasta - vuelta * largo;
      const t0 = inicio + hasta * seg;
      // melodía: notas que empiezan en este cuarto de pulso
      for (const n of notas) {
        if (Math.abs(n.pulso - p) < 1e-6 && n.grado !== null) {
          const midi = tema.base + 12 * Math.floor(n.grado / 5) + PENTA[n.grado % 5] - 12;
          zampona(t0, n.dur * seg, hz(midi));
        }
      }
      const compas = Math.floor(p / 2) % 8, enPulso = p % 1 === 0;
      const acorde = PROGRESION[compas].map((s) => hz(tema.base - 12 + s));
      if (enPulso) {
        charango(t0, acorde, 0.035);
        bombo(t0, p % 2 === 0 ? 0.3 : 0.16);
      } else if (p % 1 === 0.5) {
        charango(t0, acorde.slice().reverse(), 0.022);   // rasgueo hacia arriba
      }
      chajchas(t0, p % 1 === 0.5 ? 0.04 : 0.018);
      hasta += 0.25;
    }
  }

  return {
    tocar(id) {
      const t = TEMAS[id] || TEMAS[1];
      if (tema === t) return;
      tema = t;
      notas = cancion(t.semilla);
      inicio = ctx.currentTime + 0.1;
      hasta = 0;
      clearInterval(reloj);
      reloj = setInterval(programar, 60);
      programar();
    },
    parar() {
      tema = null;
      clearInterval(reloj);
    },
  };
}

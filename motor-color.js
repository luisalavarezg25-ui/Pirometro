/*
 * motor-color.js — núcleo de estimación de temperatura por color.
 * Sin dependencias del DOM: recibe píxeles RGBA (Uint8ClampedArray) y una tabla,
 * y devuelve la estimación. Pensado para reutilizarse tal cual en la versión
 * móvil (PWA / Capacitor) con fotogramas de la cámara.
 */
(function (root) {
  'use strict';

  // ---------- Utilidades de color ----------
  function srgbALineal(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linealASrgb(v) {
    v = Math.max(0, Math.min(1, v));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  }
  var LUT_LINEAL = new Float32Array(256);
  for (var i = 0; i < 256; i++) LUT_LINEAL[i] = srgbALineal(i);

  function rgbAHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  // Rasgos independientes de la exposición: cocientes G/R y B/R en espacio lineal.
  function rasgos(linR, linG, linB) {
    var r = Math.max(linR, 1e-6);
    return [linG / r, linB / r];
  }
  // B/R pesa menos: en rojos y naranjas es casi cero y muy ruidoso.
  var PESO_BR = 0.5;
  function distancia(a, b) {
    var dx = a[0] - b[0], dy = (a[1] - b[1]) * PESO_BR;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---------- Preparación de la tabla ----------
  function prepararTabla(tabla) {
    // Solo bandas de incandescencia con brillo visible (se ignoran los colores de revenido
    // y la entrada «sin brillo», que no tiene límite inferior).
    var entradas = tabla.entradas.filter(function (e) {
      return (!e.tipo || e.tipo === 'incandescencia') && !(('t_min_c' in e) && e.t_min_c === null);
    }).sort(function (a, b) { return a.temperatura_c - b.temperatura_c; });
    return {
      meta: tabla,
      entradas: entradas.map(function (e) {
        return {
          color: e.color,
          t: e.temperatura_c,
          rgb: e.rgb,
          tMin: e.t_min_c, tMax: e.t_max_c, incertidumbre: e.incertidumbre_c,
          f: rasgos(LUT_LINEAL[e.rgb[0]], LUT_LINEAL[e.rgb[1]], LUT_LINEAL[e.rgb[2]]),
          h: tonoEnvuelto(rgbAHsv(e.rgb[0], e.rgb[1], e.rgb[2]).h)
        };
      })
    };
  }

  // Tono con los rosados/magentas (h > 300°) pasados a negativo, para que el rojo sea continuo.
  function tonoEnvuelto(h) { return h > 300 ? h - 360 : h; }

  // Temperatura según el tono (H): interpolación lineal sobre los tonos de la tabla.
  function temperaturaPorTono(h, tablaP) {
    var E = tablaP.entradas;
    if (h <= E[0].h) return E[0].t;
    for (var k = 0; k < E.length - 1; k++) {
      if (h <= E[k + 1].h) return E[k].t + (h - E[k].h) / (E[k + 1].h - E[k].h) * (E[k + 1].t - E[k].t);
    }
    return E[E.length - 1].t;
  }
  function entradaParaTemperatura(t, tablaP) {
    var E = tablaP.entradas, mejor = E[0];
    E.forEach(function (e) { if (Math.abs(e.t - t) < Math.abs(mejor.t - t)) mejor = e; });
    return mejor;
  }

  // Calibración con fotos de temperatura conocida: puntos {h, t}. Interpola por tono entre puntos;
  // fuera de su rango sigue la pendiente de la tabla desde el punto extremo.
  function temperaturaCalibrada(h, puntos, tablaP, base) {
    base = base || function (x) { return temperaturaPorTono(x, tablaP); };
    var P = puntos.slice().sort(function (a, b) { return a.h - b.h; });
    if (h <= P[0].h) return P[0].t + base(h) - base(P[0].h);
    var u = P[P.length - 1];
    if (h >= u.h) return u.t + base(h) - base(u.h);
    for (var k = 0; k < P.length - 1; k++) {
      if (h <= P[k + 1].h) {
        var d = P[k + 1].h - P[k].h;
        return d > 0 ? P[k].t + (h - P[k].h) / d * (P[k + 1].t - P[k].t) : (P[k].t + P[k + 1].t) / 2;
      }
    }
    return u.t;
  }

  // Proyecta el rasgo medido sobre la polilínea de la tabla e interpola la temperatura.
  function estimarPorTabla(f, tablaP) {
    var E = tablaP.entradas, mejor = null;
    for (var k = 0; k < E.length - 1; k++) {
      var a = E[k].f, b = E[k + 1].f;
      var vx = b[0] - a[0], vy = (b[1] - a[1]) * PESO_BR;
      var wx = f[0] - a[0], wy = (f[1] - a[1]) * PESO_BR;
      var L2 = vx * vx + vy * vy;
      var u = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
      u = Math.max(0, Math.min(1, u));
      var p = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])];
      var d = distancia(f, p);
      if (!mejor || d < mejor.d) mejor = { d: d, k: k, u: u };
    }
    var t = E[mejor.k].t + mejor.u * (E[mejor.k + 1].t - E[mejor.k].t);
    var cercana = mejor.u < 0.5 ? E[mejor.k] : E[mejor.k + 1];
    return { temperatura_c: t, distancia: mejor.d, color: cercana.color, entradaCercana: cercana };
  }

  // ---------- Estimación física: radiación de cuerpo negro (Planck) ----------
  // Funciones de igualación CIE 1931 aproximadas (Wyman, Sloan y Shirley, 2013).
  function g(l, mu, s1, s2) { var t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
  function cieX(l) { return 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2); }
  function cieY(l) { return 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1); }
  function cieZ(l) { return 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8); }

  function cuerpoNegroLineal(tempC) {
    var T = tempC + 273.15, X = 0, Y = 0, Z = 0;
    for (var l = 380; l <= 780; l += 5) {
      var lm = l * 1e-9;
      var B = 1 / (Math.pow(lm, 5) * (Math.exp(1.4388e-2 / (lm * T)) - 1));
      X += B * cieX(l); Y += B * cieY(l); Z += B * cieZ(l);
    }
    var r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    var gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    var b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
    var m = Math.max(r, gg, b);
    return [Math.max(0, r) / m, Math.max(0, gg) / m, Math.max(0, b) / m];
  }

  var CURVA_PLANCK = null;
  function curvaPlanck() {
    if (CURVA_PLANCK) return CURVA_PLANCK;
    CURVA_PLANCK = [];
    for (var t = 450; t <= 1700; t += 5) {
      var lin = cuerpoNegroLineal(t);
      CURVA_PLANCK.push({ t: t, lin: lin, f: rasgos(lin[0], lin[1], lin[2]) });
    }
    return CURVA_PLANCK;
  }
  function estimarPorPlanck(f) {
    var C = curvaPlanck(), mejor = null;
    for (var k = 0; k < C.length; k++) {
      var d = distancia(f, C[k].f);
      if (!mejor || d < mejor.d) mejor = { d: d, t: C[k].t };
    }
    return { temperatura_c: mejor.t, distancia: mejor.d };
  }
  function colorCuerpoNegroSrgb(tempC) {
    var lin = cuerpoNegroLineal(tempC);
    return lin.map(function (v) { return Math.round(linealASrgb(v)); });
  }

  // ---------- Medición de una región ----------
  /*
   * pix: Uint8ClampedArray RGBA, ancho/alto en píxeles.
   * rect: {x, y, w, h} o null para modo automático (busca la zona incandescente).
   */
  function medirRegion(pix, ancho, alto, rect) {
    var auto = !rect;
    var x0 = auto ? 0 : Math.max(0, Math.floor(rect.x)), y0 = auto ? 0 : Math.max(0, Math.floor(rect.y));
    var x1 = auto ? ancho : Math.min(ancho, Math.ceil(rect.x + rect.w)), y1 = auto ? alto : Math.min(alto, Math.ceil(rect.y + rect.h));
    var paso = auto ? Math.max(1, Math.floor(Math.sqrt((ancho * alto) / 250000))) : 1;
    var validos = [], saturados = [], total = 0, oscuros = 0;
    for (var y = y0; y < y1; y += paso) {
      for (var x = x0; x < x1; x += paso) {
        var o = (y * ancho + x) * 4, r = pix[o], gg = pix[o + 1], b = pix[o + 2];
        total++;
        var max = Math.max(r, gg, b);
        if (max < 45) { oscuros++; continue; }
        // En modo automático solo cuenta lo que parece metal incandescente (R ≥ G ≥ B aprox.).
        if (auto && !(r >= 60 && r >= gg && gg >= b * 0.85)) continue;
        if (max >= 250) saturados.push(o); else validos.push(o);
      }
    }
    var usados = validos, aviso = null;
    if (validos.length < 20 && saturados.length > validos.length) {
      usados = validos.concat(saturados);
      aviso = 'saturada';
    }
    if (usados.length === 0) return { ok: false, total: total, oscuros: oscuros, saturados: saturados.length };

    // Nos quedamos con la mitad más luminosa: la superficie caliente, no los bordes ni reflejos tenues.
    var lum = usados.map(function (o) {
      return { o: o, y: 0.2126 * LUT_LINEAL[pix[o]] + 0.7152 * LUT_LINEAL[pix[o + 1]] + 0.0722 * LUT_LINEAL[pix[o + 2]] };
    });
    lum.sort(function (a, b) { return b.y - a.y; });
    var n = Math.max(1, Math.ceil(lum.length * 0.5));
    var sr = 0, sg = 0, sb = 0;
    for (var k = 0; k < n; k++) {
      var p = lum[k].o;
      sr += LUT_LINEAL[pix[p]]; sg += LUT_LINEAL[pix[p + 1]]; sb += LUT_LINEAL[pix[p + 2]];
    }
    var lin = [sr / n, sg / n, sb / n];
    var rgb = lin.map(function (v) { return Math.round(linealASrgb(v)); });
    var fracSat = saturados.length / Math.max(1, validos.length + saturados.length);
    if (!aviso && fracSat > 0.3) aviso = 'parcialmente-saturada';
    return {
      ok: true, lin: lin, rgb: rgb, hsv: rgbAHsv(rgb[0], rgb[1], rgb[2]),
      usados: n, candidatos: usados.length, total: total, oscuros: oscuros,
      saturados: saturados.length, fraccionSaturada: fracSat, aviso: aviso, auto: auto
    };
  }

  // ---------- Luz ambiente ----------
  // Brillo medio (V de HSV, 0–1) de lo que no es metal incandescente: sirve para sugerir el nivel de luz.
  function medirFondo(pix, ancho, alto) {
    var paso = Math.max(1, Math.floor(Math.sqrt((ancho * alto) / 60000))), suma = 0, n = 0;
    for (var y = 0; y < alto; y += paso) for (var x = 0; x < ancho; x += paso) {
      var o = (y * ancho + x) * 4, r = pix[o], gg = pix[o + 1], b = pix[o + 2], max = Math.max(r, gg, b);
      var brilla = r >= 60 && r >= gg && gg >= b * 0.85 && (max - Math.min(r, gg, b)) / max > 0.45;
      if (brilla || max >= 250) continue;
      suma += max / 255; n++;
    }
    return n ? suma / n : 0;
  }
  function nivelLuzSugerido(vFondo) {
    return vFondo < 0.08 ? 'oscuridad' : vFondo < 0.22 ? 'penumbra' : vFondo < 0.42 ? 'interior_iluminado' : vFondo < 0.65 ? 'luz_diurna' : 'sol_directo';
  }
  // Corrección (°C a sumar) según la luz ambiente; se reduce por encima de 800 °C.
  function ajusteIluminacion(tempC, nivel, tablaP) {
    var aj = tablaP.meta.ajuste_iluminacion;
    if (!aj || !aj.valores_C || !(nivel in aj.valores_C)) return 0;
    var v = aj.valores_C[nivel];
    return tempC > 800 ? v * (aj.factor_por_encima_800C != null ? aj.factor_por_encima_800C : 1) : v;
  }

  // Fusión por inversa de la varianza: T = Σ(T_i/σ_i²)/Σ(1/σ_i²). Marca discrepancia si dos estimadores difieren > 2σ.
  function fusionar(estimaciones) {
    var sw = 0, st = 0, discrepan = false;
    estimaciones.forEach(function (e) { var w = 1 / (e.sigma * e.sigma); sw += w; st += w * e.t; });
    for (var a = 0; a < estimaciones.length; a++) for (var b = a + 1; b < estimaciones.length; b++) {
      var A = estimaciones[a], B = estimaciones[b];
      if (Math.abs(A.t - B.t) > 2 * Math.sqrt(A.sigma * A.sigma + B.sigma * B.sigma)) discrepan = true;
    }
    return { t: st / sw, sigma: Math.sqrt(1 / sw), discrepan: discrepan };
  }

  // ---------- Estimación completa ----------
  // Curva H→T de fábrica (calibracion_foto_v1 de la tabla): interpolación lineal, constante fuera de los extremos.
  function temperaturaPorCurva(h, puntos) {
    var P = puntos.slice().sort(function (a, b) { return a.H - b.H; });
    if (h <= P[0].H) return P[0].T_c;
    for (var k = 0; k < P.length - 1; k++) {
      if (h <= P[k + 1].H) return P[k].T_c + (h - P[k].H) / (P[k + 1].H - P[k].H) * (P[k + 1].T_c - P[k].T_c);
    }
    return P[P.length - 1].T_c;
  }
  function rangoMedido(puntos) {
    var hs = puntos.filter(function (p) { return /medido/.test(p.nota || '') && !/extrapolado/.test(p.nota || ''); }).map(function (p) { return p.H; });
    return hs.length ? [Math.min.apply(null, hs), Math.max.apply(null, hs)] : null;
  }

  function estimar(medida, tablaP, nivelLuz, puntosCal) {
    var f = rasgos(medida.lin[0], medida.lin[1], medida.lin[2]);
    var porRelacion = estimarPorTabla(f, tablaP);
    var h = tonoEnvuelto(medida.hsv.h);
    var calibrado = !!(puntosCal && puntosCal.length);
    // Estimador principal: tono (H). Con fotos reales sigue el orden de temperaturas mejor que la relación G/R.
    var puntosCurva = tablaP.meta.calibracion_foto_v1 && tablaP.meta.calibracion_foto_v1.puntos;
    var curva = !calibrado && puntosCurva;
    // La calibración del usuario desplaza la curva de fábrica (o la tabla) para que pase por sus puntos.
    var baseCal = puntosCurva ? function (x) { return temperaturaPorCurva(x, puntosCurva); } : null;
    var tTono = calibrado ? temperaturaCalibrada(h, puntosCal, tablaP, baseCal) : curva ? temperaturaPorCurva(h, curva) : temperaturaPorTono(h, tablaP);
    var cercana = entradaParaTemperatura(tTono, tablaP);
    var porTabla = { temperatura_c: tTono, distancia: porRelacion.distancia, color: cercana.color, entradaCercana: cercana };
    var porPlanck = estimarPorPlanck(f);
    // Con calibración la luz ambiente ya está incluida en los puntos de referencia.
    var ajuste = (calibrado || curva) ? 0 : ajusteIluminacion(porTabla.temperatura_c, nivelLuz || 'penumbra', tablaP);
    // De momento solo entra el estimador por tono/banda. La relación G/R entrará en la versión móvil,
    // cuando la cámara esté calibrada; sin calibrar no concuerda con los colores típicos de la tabla.
    var sigmaBanda = (porTabla.entradaCercana.incertidumbre || 75), extrapolado = false;
    if (curva) {
      var inc = tablaP.meta.calibracion_foto_v1.incertidumbre_c || { medido: 60, extrapolado: 125 }, rm = rangoMedido(curva);
      extrapolado = !rm || h < rm[0] - 2 || h > rm[1] + 2;
      sigmaBanda = extrapolado ? inc.extrapolado : inc.medido;
      if (medida.fraccionSaturada > 0.3) sigmaBanda += 50;
    }
    var fusion = fusionar([{ id: 'tono_banda', t: porTabla.temperatura_c + ajuste, sigma: sigmaBanda }]);
    var confianza = calibrado ? 'alta' : curva ? (extrapolado ? 'baja' : 'media') : porTabla.distancia < 0.03 ? 'alta' : porTabla.distancia < 0.08 ? 'media' : 'baja';
    var motivos = [];
    if (curva && extrapolado) motivos.push('Fuera del tramo medido con fotos reales (800–900 °C): calibra este teléfono para más precisión.');
    if (!calibrado && !curva && porTabla.distancia >= 0.08) motivos.push('El color medido no se parece a ningún color de incandescencia de la tabla.');
    if (medida.aviso === 'saturada') { confianza = 'baja'; motivos.push('La zona está sobreexpuesta (píxeles quemados): baja la exposición o usa otra foto.'); }
    else if (medida.aviso === 'parcialmente-saturada') { if (confianza === 'alta') confianza = 'media'; motivos.push('Más del 30 % de la zona está sobreexpuesta y se ha descartado: baja la exposición.'); }
    if (porTabla.temperatura_c < 700) { if (confianza === 'alta') confianza = 'media'; motivos.push('Por debajo de unos 700 °C los rojos cambian sobre todo de brillo, no de tono, y la cámara los distingue peor.'); }
    var rgbM = medida.rgb, sinQuemar = medida.fraccionSaturada < 0.3 && medida.aviso !== 'saturada';
    // Un blanco real de incandescencia sale quemado (V≈1). Un color poco saturado y sin quemar es acero
    // gris reflejando la luz de la fragua: se trata como «sin incandescencia».
    var sinIncandescencia = sinQuemar && medida.hsv.s < 0.4 && medida.hsv.v < 0.95;
    if (sinIncandescencia) {
      motivos = ['Color poco saturado y sin quemar: el acero no muestra brillo propio en la foto y solo refleja la luz del entorno. Con fuego o luz fuerte detrás, por debajo de unos 700 °C la cámara no distingue el acero caliente del frío.'];
    }
    if (!calibrado && !curva && rgbM[2] / Math.max(1, rgbM[1]) > 0.8 && medida.hsv.v < 0.95 && medida.hsv.s > 0.1) {
      confianza = 'baja';
      motivos.push('El azul es casi tan alto como el verde (tono rosado o azulado): el balance de blancos de la cámara ha alterado el color. Fíjalo en «luz día».');
    }
    if (medida.hsv.h > 60 && medida.hsv.h < 330 && medida.hsv.s > 0.25) { confianza = 'baja'; motivos.push('El tono no es el de un metal incandescente (rojo, naranja, amarillo o blanco).'); }
    if (fusion.discrepan) { confianza = 'baja'; motivos.push('Los métodos de estimación no coinciden entre sí: toma la lectura como un rango amplio.'); }
    return {
      temperatura_c: fusion.t,
      incertidumbre_c: fusion.sigma,
      ajusteLuz_c: ajuste,
      temperaturaSinAjuste_c: porTabla.temperatura_c,
      color: porTabla.color,
      confianza: confianza,
      motivos: motivos,
      porTabla: porTabla,
      porRelacion: porRelacion,
      tono: h,
      calibrado: calibrado,
      curvaFabrica: !!curva,
      sinIncandescencia: sinIncandescencia,
      porPlanck: porPlanck,
      rasgos: f
    };
  }

  // Color sRGB de la tabla para una temperatura dada (interpolado), útil para dibujar escalas.
  function colorTablaParaTemperatura(tempC, tablaP) {
    var E = tablaP.entradas;
    if (tempC <= E[0].t) return E[0].rgb.slice();
    for (var k = 0; k < E.length - 1; k++) {
      if (tempC <= E[k + 1].t) {
        var u = (tempC - E[k].t) / (E[k + 1].t - E[k].t);
        return [0, 1, 2].map(function (c) {
          return Math.round(linealASrgb(LUT_LINEAL[E[k].rgb[c]] * (1 - u) + LUT_LINEAL[E[k + 1].rgb[c]] * u));
        });
      }
    }
    return E[E.length - 1].rgb.slice();
  }

  var API = {
    prepararTabla: prepararTabla,
    medirRegion: medirRegion,
    estimar: estimar,
    temperaturaPorTono: temperaturaPorTono,
    temperaturaCalibrada: temperaturaCalibrada,
    tonoEnvuelto: tonoEnvuelto,
    medirFondo: medirFondo,
    nivelLuzSugerido: nivelLuzSugerido,
    ajusteIluminacion: ajusteIluminacion,
    fusionar: fusionar,
    estimarPorTabla: estimarPorTabla,
    estimarPorPlanck: estimarPorPlanck,
    colorTablaParaTemperatura: colorTablaParaTemperatura,
    colorCuerpoNegroSrgb: colorCuerpoNegroSrgb,
    rgbAHsv: rgbAHsv,
    rasgos: rasgos,
    srgbALineal: srgbALineal,
    linealASrgb: linealASrgb
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MotorColor = API;
})(typeof self !== 'undefined' ? self : this);

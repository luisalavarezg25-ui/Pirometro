/* app.js — Pirómetro de Color, versión móvil con cámara en tiempo real.
 * Usa el mismo motor (motor-color.js) y la misma tabla que el prototipo por foto. */
(function () {
  'use strict';
  var M = window.MotorColor;
  var $ = function (id) { return document.getElementById(id); };
  var video = $('video'), foto = $('foto');
  var lienzo = document.createElement('canvas'), lctx = lienzo.getContext('2d', { willReadFrequently: true });
  var tablaP = null, stream = null, track = null, caps = {}, bloqueado = false, pausado = false, modoFoto = false;
  var historial = [], ultima = null, ultimoTono = null, ultimoTiempo = 0, ajustando = false;
  var CLAVE_CAL = 'pirometro-movil-calibracion', puntosCal = [];
  var ANCHO_ANALISIS = 480, FPS = 6;

  try { puntosCal = JSON.parse(localStorage.getItem(CLAVE_CAL) || '[]') || []; } catch (e) { puntosCal = []; }

  function rgbCss(c) { return 'rgb(' + c.join(',') + ')'; }
  function estado(txt, cls) { var e = $('estadoCam'); e.textContent = txt; e.className = 'estado ' + (cls || ''); }

  // ---------- Tabla ----------
  function cargarTabla() {
    return fetch('tabla-color-temperatura.json').then(function (r) { return r.json(); })
      .then(function (t) { tablaP = M.prepararTabla(t); });
  }

  // ---------- Retícula ----------
  function ladoReticula() { return Math.min(innerWidth, innerHeight) * $('tamRet').value / 100 * 2.2; }
  function colocarReticula() {
    var r = $('reticula'), l = ladoReticula();
    r.style.width = r.style.height = l + 'px';
    var alto = innerHeight - $('panel').offsetHeight;
    r.style.left = (innerWidth - l) / 2 + 'px';
    r.style.top = Math.max(60, (alto - l) / 2) + 'px';
  }
  // Rectángulo de la retícula en coordenadas de la fuente (vídeo o foto), teniendo en cuenta object-fit: cover.
  function rectFuente(fw, fh) {
    var r = $('reticula').getBoundingClientRect();
    var esc = Math.max(innerWidth / fw, innerHeight / fh);
    var ox = (innerWidth - fw * esc) / 2, oy = (innerHeight - fh * esc) / 2;
    return { x: (r.left - ox) / esc, y: (r.top - oy) / esc, w: r.width / esc, h: r.height / esc };
  }

  // ---------- Cámara ----------
  function iniciarCamara() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('msgInicio').textContent = 'Este navegador no da acceso a la cámara. Abre la app en Chrome para Android o analiza una foto.';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(function (s) {
        stream = s; track = s.getVideoTracks()[0];
        video.srcObject = s; modoFoto = false; foto.style.display = 'none'; video.style.display = '';
        $('inicio').hidden = true;
        caps = track.getCapabilities ? track.getCapabilities() : {};
        prepararControles();
        estado('Exposición automática', 'warn');
        colocarReticula();
        requestAnimationFrame(bucle);
      })
      .catch(function (err) {
        $('msgInicio').textContent = err && err.name === 'NotAllowedError'
          ? 'Has denegado el permiso de cámara. Actívalo en los ajustes del navegador para este sitio.'
          : 'No se pudo abrir la cámara (' + (err && err.name || 'error') + ').';
      });
  }

  function soporta(nombre, valor) { return caps[nombre] && (!valor || caps[nombre].indexOf(valor) >= 0); }
  function prepararControles() {
    var expManual = soporta('exposureMode', 'manual') && caps.exposureTime;
    var compensa = !!caps.exposureCompensation;
    var wbManual = soporta('whiteBalanceMode', 'manual') && caps.colorTemperature;
    $('btnBloqueo').disabled = !(expManual || compensa || wbManual);
    $('btnAutoExp').disabled = !(expManual || compensa);
    $('dCam').textContent = [
      expManual ? 'exposición manual' : compensa ? 'compensación de exposición' : 'sin control de exposición',
      wbManual ? 'balance de blancos manual' : 'sin control de balance de blancos'
    ].join(' · ');
    if (!expManual && !compensa && !wbManual) {
      aviso('Este navegador no permite fijar la exposición ni el balance de blancos (pasa en iPhone). Las lecturas variarán con la luz.');
    }
    var exp = $('exp');
    if (expManual) { exp.min = caps.exposureTime.min; exp.max = Math.min(caps.exposureTime.max, 2000); exp.step = caps.exposureTime.step || 1; }
    else if (compensa) { exp.min = caps.exposureCompensation.min; exp.max = caps.exposureCompensation.max; exp.step = caps.exposureCompensation.step || 0.1; }
    var wb = $('wb');
    $('lblTempColor').hidden = !wbManual;
    if (wbManual) { wb.min = caps.colorTemperature.min; wb.max = caps.colorTemperature.max; wb.step = caps.colorTemperature.step || 50; wb.value = 5500; }
  }

  function aplicar(restr) {
    if (!track) return Promise.reject();
    return track.applyConstraints({ advanced: [restr] });
  }
  function fijar() {
    var s = track.getSettings ? track.getSettings() : {}, r = {};
    if (soporta('exposureMode', 'manual') && caps.exposureTime) {
      r.exposureMode = 'manual';
      r.exposureTime = s.exposureTime || (caps.exposureTime.min + caps.exposureTime.max) / 8;
      if (caps.iso) r.iso = s.iso || caps.iso.min;
      $('exp').value = r.exposureTime;
    } else if (caps.exposureCompensation) {
      $('exp').value = s.exposureCompensation || 0;
    }
    if (soporta('whiteBalanceMode', 'manual') && caps.colorTemperature) {
      r.whiteBalanceMode = 'manual';
      r.colorTemperature = Math.max(caps.colorTemperature.min, Math.min(caps.colorTemperature.max, 5500));
    }
    return aplicar(r).then(function () {
      bloqueado = true; historial = [];
      $('btnBloqueo').setAttribute('aria-pressed', 'true'); $('btnBloqueo').textContent = 'Exposición y color fijados';
      $('filaExp').hidden = false;
      estado('Fijado · luz día', 'ok');
    }).catch(function () { aviso('La cámara no aceptó fijar la exposición o el color.'); });
  }
  function soltar() {
    var r = {};
    if (soporta('exposureMode', 'continuous')) r.exposureMode = 'continuous';
    if (soporta('whiteBalanceMode', 'continuous')) r.whiteBalanceMode = 'continuous';
    aplicar(r).finally(function () {
      bloqueado = false; historial = [];
      $('btnBloqueo').setAttribute('aria-pressed', 'false'); $('btnBloqueo').textContent = 'Fijar exposición y color';
      $('filaExp').hidden = true;
      estado('Exposición automática', 'warn');
    });
  }
  function cambiarExposicion(v) {
    if (soporta('exposureMode', 'manual') && caps.exposureTime) return aplicar({ exposureMode: 'manual', exposureTime: +v });
    if (caps.exposureCompensation) return aplicar({ exposureCompensation: +v });
    return Promise.resolve();
  }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Baja la exposición hasta que casi nada de la retícula salga quemado (y la sube si sale muy oscura).
  function ajustarExposicion() {
    if (ajustando || !track) return;
    ajustando = true; $('btnAutoExp').disabled = true; aviso('Ajustando exposición…');
    var empezar = bloqueado ? Promise.resolve() : fijar();
    var exp = $('exp'), min = +exp.min, max = +exp.max, paso = 0;
    function iter() {
      if (paso++ > 14 || !ultima) return Promise.resolve();
      var v = +exp.value, sat = ultima.fraccionSaturada, brillo = ultima.hsv ? ultima.hsv.v : 0;
      var nuevo = v;
      if (sat > 0.05) nuevo = caps.exposureTime ? Math.max(min, v * 0.65) : Math.max(min, v - 0.5);
      else if (brillo < 0.55) nuevo = caps.exposureTime ? Math.min(max, v * 1.3) : Math.min(max, v + 0.3);
      else return Promise.resolve();
      if (nuevo === v) return Promise.resolve();
      exp.value = nuevo;
      return cambiarExposicion(nuevo).then(function () { return espera(450); }).then(iter);
    }
    empezar.then(function () { return espera(400); }).then(iter).finally(function () {
      ajustando = false; $('btnAutoExp').disabled = false; historial = [];
      aviso(ultima && ultima.fraccionSaturada > 0.05 ? 'Sigue habiendo zonas quemadas: la cámara no baja más la exposición.' : 'Exposición ajustada.');
    });
  }

  // ---------- Análisis ----------
  function bucle(t) {
    if (!modoFoto && stream) requestAnimationFrame(bucle);
    if (pausado || modoFoto || !tablaP || video.readyState < 2) return;
    if (t - ultimoTiempo < 1000 / FPS) return;
    ultimoTiempo = t;
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    analizarFuente(video, vw, vh);
  }
  function analizarFuente(fuente, fw, fh) {
    var k = Math.min(1, ANCHO_ANALISIS / Math.max(fw, fh));
    lienzo.width = Math.round(fw * k); lienzo.height = Math.round(fh * k);
    lctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    var r = rectFuente(fw, fh), rect = { x: r.x * k, y: r.y * k, w: Math.max(2, r.w * k), h: Math.max(2, r.h * k) };
    var datos = lctx.getImageData(0, 0, lienzo.width, lienzo.height);
    var m = M.medirRegion(datos.data, datos.width, datos.height, rect);
    mostrar(m);
  }
  function mediana(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }

  function mostrar(m) {
    ultima = m.ok ? m : null;
    if (!m.ok) {
      historial = [];
      $('temp').innerHTML = (m.total && m.oscuros / m.total > 0.8 ? '&lt; 500' : '—') + '<small>°C</small>';
      $('nombre').textContent = 'Sin brillo en la retícula'; $('conf').textContent = ''; $('sw').style.background = 'transparent';
      return;
    }
    var r = M.estimar(m, tablaP, 'penumbra', puntosCal);
    ultimoTono = r.tono;
    $('sw').style.background = rgbCss(m.rgb);
    $('dRgb').textContent = m.rgb.join(', ');
    $('dHsv').textContent = Math.round(m.hsv.h) + '° / ' + Math.round(m.hsv.s * 100) + ' % / ' + Math.round(m.hsv.v * 100) + ' %';
    $('dSat').textContent = Math.round(m.fraccionSaturada * 100) + ' %';
    if (r.sinIncandescencia) {
      historial = [];
      $('temp').innerHTML = '&lt; 750<small>°C</small>'; $('nombre').textContent = 'Sin brillo apreciable';
      $('conf').className = 'conf media'; $('conf').textContent = 'Fuera de rango';
      aviso(r.motivos[0]);
      return;
    }
    historial.push(r.temperatura_c); if (historial.length > 7) historial.shift();
    var t = Math.round(mediana(historial) / 5) * 5;
    $('temp').innerHTML = '≈ ' + t + '<small>°C ±' + Math.round(r.incertidumbre_c) + '</small>';
    $('nombre').textContent = r.color;
    var conf = r.confianza;
    if (!bloqueado && !modoFoto && conf === 'alta') conf = 'media';
    $('conf').className = 'conf ' + conf;
    $('conf').textContent = 'Confianza ' + conf + (r.calibrado ? ' · calibrada en este teléfono' : r.curvaFabrica ? ' · curva de fábrica' : '');
    var txt = r.motivos[0] || '';
    if (!txt && !bloqueado && !modoFoto) txt = 'Fija la exposición y el color para lecturas estables.';
    aviso(txt);
  }
  function aviso(t) { $('aviso').textContent = t || ''; }

  // ---------- Foto ----------
  function cargarFoto(file) {
    if (!file) return;
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      modoFoto = true; pausado = false;
      foto.width = img.naturalWidth; foto.height = img.naturalHeight;
      foto.getContext('2d').drawImage(img, 0, 0);
      foto.style.display = 'block'; video.style.display = 'none';
      $('inicio').hidden = true; colocarReticula();
      estado('Foto', '');
      historial = []; analizarFuente(foto, foto.width, foto.height);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  function reanalizarFoto() { if (modoFoto) { historial = []; analizarFuente(foto, foto.width, foto.height); } }

  // ---------- Calibración ----------
  function pintarCal() {
    $('listaCal').innerHTML = puntosCal.map(function (p, i) {
      return '<li>H ' + p.h.toFixed(1) + '° → ' + p.t + ' °C<button type="button" data-i="' + i + '" aria-label="Quitar referencia">×</button></li>';
    }).join('');
    $('btnCalBorrar').hidden = !puntosCal.length;
  }
  function guardarCal() {
    try { localStorage.setItem(CLAVE_CAL, JSON.stringify(puntosCal)); } catch (e) {}
    pintarCal(); historial = []; reanalizarFoto();
  }

  // ---------- Eventos ----------
  $('btnIniciar').addEventListener('click', iniciarCamara);
  $('btnAyuda').addEventListener('click', function () { $('ayuda').hidden = false; });
  $('btnCerrarAyuda').addEventListener('click', function () { $('ayuda').hidden = true; });
  $('archivo').addEventListener('change', function (e) { cargarFoto(e.target.files[0]); e.target.value = ''; });
  $('archivo2').addEventListener('change', function (e) { cargarFoto(e.target.files[0]); e.target.value = ''; });
  $('btnPausa').addEventListener('click', function () {
    if (modoFoto) { if (stream) { modoFoto = false; foto.style.display = 'none'; video.style.display = ''; requestAnimationFrame(bucle); estado(bloqueado ? 'Fijado · luz día' : 'Exposición automática', bloqueado ? 'ok' : 'warn'); } return; }
    pausado = !pausado;
    $('btnPausa').textContent = pausado ? 'Seguir midiendo' : 'Congelar lectura';
  });
  $('btnBloqueo').addEventListener('click', function () { bloqueado ? soltar() : fijar(); });
  $('btnAutoExp').addEventListener('click', ajustarExposicion);
  $('exp').addEventListener('input', function (e) { historial = []; cambiarExposicion(e.target.value); });
  $('wb').addEventListener('input', function (e) { historial = []; aplicar({ whiteBalanceMode: 'manual', colorTemperature: +e.target.value }); });
  $('tamRet').addEventListener('input', function () { colocarReticula(); historial = []; reanalizarFoto(); });
  $('btnCal').addEventListener('click', function () {
    var v = parseFloat($('tReal').value);
    if (ultimoTono == null || !(v >= 300 && v <= 1600)) { $('tReal').focus(); return; }
    puntosCal.push({ h: Math.round(ultimoTono * 10) / 10, t: Math.round(v) });
    $('tReal').value = ''; guardarCal();
  });
  $('btnCalBorrar').addEventListener('click', function () { puntosCal = []; guardarCal(); });
  $('listaCal').addEventListener('click', function (e) {
    var i = e.target.getAttribute('data-i'); if (i == null) return; puntosCal.splice(+i, 1); guardarCal();
  });
  addEventListener('resize', colocarReticula);
  new ResizeObserver(colocarReticula).observe($('panel'));
  document.addEventListener('visibilitychange', function () { if (!document.hidden && stream) historial = []; });

  // Interfaz mínima para capturas.js
  window.Pirometro = {
    fuenteActual: function () { return modoFoto ? { el: foto, w: foto.width, h: foto.height } : (video.videoWidth ? { el: video, w: video.videoWidth, h: video.videoHeight } : null); },
    rectFuente: rectFuente,
    ultimaMedida: function () { return ultima; },
    ajustesCamara: function () { return track && track.getSettings ? track.getSettings() : null; },
    bloqueado: function () { return bloqueado; },
    estimar: function (m) { return m && tablaP ? M.estimar(m, tablaP, 'penumbra', puntosCal) : null; }
  };

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  pintarCal(); colocarReticula();
  cargarTabla().catch(function () { $('msgInicio').textContent = 'No se pudo cargar la tabla de colores.'; });
})();

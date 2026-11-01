/* capturas.js — guarda fotos de calibración (recorte de la retícula + ajustes de cámara + temperatura real)
 * en el propio teléfono (IndexedDB) y las exporta como JPEG + CSV. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = window.Pirometro, db = null;

  function abrir() {
    return new Promise(function (ok, ko) {
      var r = indexedDB.open('pirometro-capturas', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('capturas', { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = function () { db = r.result; ok(db); };
      r.onerror = function () { ko(r.error); };
    });
  }
  function tx(modo, fn) {
    return new Promise(function (ok, ko) {
      var t = db.transaction('capturas', modo), st = t.objectStore('capturas'), res = fn(st);
      t.oncomplete = function () { ok(res && res.result); }; t.onerror = function () { ko(t.error); };
    });
  }
  function todas() { return tx('readonly', function (st) { return st.getAll(); }); }
  function msg(t) { $('msgCaptura').textContent = t; }
  function refrescar() {
    return todas().then(function (l) {
      $('numCapturas').textContent = l.length ? '(' + l.length + ')' : '';
      $('btnExportar').disabled = $('btnBorrarCapturas').disabled = !l.length;
    });
  }

  function recorte(fuente) {
    // Recorte de la retícula con un margen alrededor, a resolución completa.
    var r = P.rectFuente(fuente.w, fuente.h), m = r.w * 0.5;
    var x = Math.max(0, r.x - m), y = Math.max(0, r.y - m);
    var w = Math.min(fuente.w - x, r.w + 2 * m), h = Math.min(fuente.h - y, r.h + 2 * m);
    var c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
    c.getContext('2d').drawImage(fuente.el, x, y, w, h, 0, 0, c.width, c.height);
    return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.95); });
  }

  function guardar() {
    var t = parseFloat($('tCaptura').value), fuente = P.fuenteActual(), m = P.ultimaMedida();
    if (!(t >= 0 && t <= 1600)) { $('tCaptura').focus(); msg('Escribe la temperatura real medida.'); return; }
    if (!fuente) { msg('Abre la cámara o una foto primero.'); return; }
    var r = P.estimar(m), aj = P.ajustesCamara() || {};
    recorte(fuente).then(function (blob) {
      var reg = {
        fecha: new Date().toISOString(), temperatura_real_c: t,
        estimacion_c: r ? Math.round(r.temperatura_c) : null,
        h: m ? +m.hsv.h.toFixed(1) : null, s: m ? +m.hsv.s.toFixed(3) : null, v: m ? +m.hsv.v.toFixed(3) : null,
        rgb: m ? m.rgb.join(' ') : '', quemado: m ? +m.fraccionSaturada.toFixed(3) : null,
        bloqueado: P.bloqueado(), exposureMode: aj.exposureMode || '', exposureTime: aj.exposureTime || '',
        exposureCompensation: aj.exposureCompensation != null ? aj.exposureCompensation : '', iso: aj.iso || '',
        whiteBalanceMode: aj.whiteBalanceMode || '', colorTemperature: aj.colorTemperature || '',
        foto: blob
      };
      return tx('readwrite', function (st) { return st.add(reg); });
    }).then(function () {
      $('tCaptura').value = ''; msg('Captura guardada.'); return refrescar();
    }).catch(function () { msg('No se pudo guardar la captura.'); });
  }

  var COLS = ['id', 'fecha', 'temperatura_real_c', 'estimacion_c', 'h', 's', 'v', 'rgb', 'quemado', 'bloqueado', 'exposureMode', 'exposureTime', 'exposureCompensation', 'iso', 'whiteBalanceMode', 'colorTemperature', 'archivo'];
  function nombre(c) { return 'captura-' + String(c.id).padStart(3, '0') + '-' + c.temperatura_real_c + 'C.jpg'; }
  function exportar() {
    todas().then(function (l) {
      var csv = COLS.join(',') + '\n' + l.map(function (c) {
        c.archivo = nombre(c);
        return COLS.map(function (k) { var v = c[k]; return v == null ? '' : String(v).replace(/,/g, ' '); }).join(',');
      }).join('\n') + '\n';
      var files = [new File([csv], 'capturas-calibracion.csv', { type: 'text/csv' })].concat(l.map(function (c) {
        return new File([c.foto], nombre(c), { type: 'image/jpeg' });
      }));
      if (navigator.canShare && navigator.canShare({ files: files })) {
        return navigator.share({ files: files, title: 'Capturas de calibración' }).then(function () { msg('Capturas compartidas.'); });
      }
      files.forEach(function (f, i) {
        setTimeout(function () {
          var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
          document.body.appendChild(a); a.click(); a.remove();
        }, i * 300);
      });
      msg('Descargando ' + files.length + ' archivos.');
    }).catch(function (e) { if (!e || e.name !== 'AbortError') msg('No se pudieron exportar las capturas.'); });
  }
  var confirmar = false;
  function borrar() {
    if (!confirmar) { confirmar = true; $('btnBorrarCapturas').textContent = 'Pulsa otra vez para borrar'; setTimeout(function () { confirmar = false; $('btnBorrarCapturas').textContent = 'Borrar todas'; }, 4000); return; }
    confirmar = false; $('btnBorrarCapturas').textContent = 'Borrar todas';
    tx('readwrite', function (st) { return st.clear(); }).then(function () { msg('Capturas borradas.'); return refrescar(); });
  }

  if (!window.indexedDB) { msg('Este navegador no permite guardar capturas.'); return; }
  abrir().then(refrescar).catch(function () { msg('Este navegador no permite guardar capturas.'); });
  $('btnCaptura').addEventListener('click', guardar);
  $('btnExportar').addEventListener('click', exportar);
  $('btnBorrarCapturas').addEventListener('click', borrar);
})();

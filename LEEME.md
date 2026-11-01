# Pirómetro de Color 1.0

App para Android que estima la temperatura del acero incandescente por su color, en tiempo real con la cámara.

## Publicarla (GitHub Pages)
1. Sube **el contenido de esta carpeta** a la raíz del repositorio (index.html tiene que quedar en la raíz).
2. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.
3. Abre `https://TU-USUARIO.github.io/TU-REPO/` en Chrome para Android → menú → «Añadir a pantalla de inicio».

El prototipo por foto queda en `…/TU-REPO/prototipo-foto/`.

## Instalable APK (opcional)
Con la app ya publicada, entra en https://www.pwabuilder.com, pega la dirección, pulsa **Package for stores → Android** y descarga el APK (o el paquete para Google Play).

## Ficheros
- `index.html`, `app.js`: interfaz y cámara.
- `capturas.js`: capturas de calibración (foto + ajustes + temperatura real, exportables a JPEG + CSV).
- `motor-color.js`: cálculo de temperatura (común con el prototipo).
- `tabla-color-temperatura.json`: tabla validada v1.4 y curva de calibración de fábrica.
- `sw.js`, `manifest.webmanifest`, iconos: instalación y uso sin conexión.

## Precisión
Sin calibrar usa una curva obtenida con fotos reales a 800, 850 y 900 °C: ±60 °C en ese tramo y ±125 °C fuera de él.
Por debajo de ~750 °C con fuego o luz fuerte detrás no distingue acero caliente de frío.
Calibrar el teléfono con 2–3 piezas a temperatura conocida mejora la precisión. Es una ayuda de taller y no sustituye a un pirómetro.

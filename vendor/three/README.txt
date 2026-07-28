three.js r160 (MIT) — vendorizado desde el tarball oficial de npm
(three@0.160.0, registry.npmjs.org), NO desde un CDN.

Por qué está aquí y no en jsdelivr: con CDN el juego cae a 2D en silencio en
cualquier red sin acceso a jsdelivr (pasó en el entorno de Claude, 403 del proxy)
y nadie se entera, porque el fallback funciona demasiado bien. Vendorizado, el 3D
arranca siempre y sin conexión.

OJO AL ACTUALIZAR: r160 es la ÚLTIMA versión que publica build/three.min.js (UMD).
Desde r161 solo hay ESM, así que subir de versión exige migrar a import map +
module scripts (ver AGENTIC_REVIEW §6.26). No basta con cambiar el número.

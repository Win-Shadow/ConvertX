const EN = {
  myAccount: "My account", adminPage: "Server admin", guestAccount: "Guest account", guestUntil: "until {x}",
  loginDisabled: "This account is turned off. Ask Jorge.", loginExpired: "This guest account has expired. Ask Jorge for a new invite.",
  inviteGone: "This invite has expired", inviteGoneSub: "Ask the person who sent it for a new link.",
  joinTitle: "You're invited", joinSub: "Make your account to start converting files.", joinGuest: "This is a guest account that lasts {n} days, then it and its files are deleted.",
  yourName: "Your name", pwHint: "At least 8 characters.", save: "Save", saved: "Saved", pwChanged: "Password changed",
  storage: "Storage", storageHint: "Originals and results both count. Delete old conversions in History to free space.",
  notifications: "Notifications", connected: "Connected", notifyDone: "Message me when a long conversion finishes", notifyDoneHint: "So you can close the page and come back later",
  disconnect: "Disconnect Telegram", tgWhy: "Get a Telegram message when your files are ready.", tgConnect: "Connect Telegram", tgWaiting: "Waiting for Telegram… tap Start there",
  tgConnected: "Telegram connected!", tgNotSetUp: "Telegram messages aren't set up on this server yet.",
  changePw: "Change password", currentPw: "Current password", newPw: "New password",
  history: "History", newConversion: "+ New conversion", account: "Account", logout: "Log out", classic: "Classic ConvertX",
  theme: "Theme", dark: "Dark", light: "Light", auto: "Auto", themeNote: "Saved on this device. Auto follows your device's dark/light setting.",
  steps: ["Add files", "Choose", "Download"],
  h1: "Change any file into the format you need.", sub: "Photos, videos, documents, voice notes — mix them all in one go.",
  drop: "Drop your files here", dropMore: "Drop more files here", dropSub: "or tap to choose · up to {max} each",
  dropAnywhere: "Drop to add", removeAll: "Remove all", next: "Next: choose formats",
  uploading: "Uploading {pct}%", checking: "Checking…", uploadFailed: "Upload failed", retry: "Retry", remove: "Remove",
  whatDo: "What should they become?", chooseSub: "We sorted your {n} files by type. The best choice is already selected — change anything you like.",
  best: "Best", change: "Change", done: "Done", settingsFor: "Settings for {x} — they change when you pick a different format.",
  techShow: "Technical details", techHide: "Hide technical details",
  perFile: "Choose per file ({n})", perFileDone: "Done choosing per file", sameAsGroup: "Same as group ({x})", setSeparately: "{n} set separately",
  otherShow: "Other formats ({n} more)", otherHide: "Hide other formats", otherNone: "No other formats for this type.", showAllN: "Show all {n}",
  onlyOther: "Pick a format for these files:",
  back: "Back", convertN: "Convert {n} files", convert1: "Convert 1 file", waitUploads: "Waiting for uploads ({n} left)",
  youGet: "What you'll get", before: "Before", after: "After (about)", time: "Time", queue: "Queue",
  queueFree: "Starts right away", queueBusy: "{n} ahead of you", keepFor: "Keep my files for",
  keep: ["24 hours", "3 days", "7 days", "Until I delete them"],
  working: "Working on it…", workingSub: "You can close this page — your files keep converting. Find them later in History.",
  allReady: "All {n} files are ready", someReady: "{d} of {n} ready — {f} need a hand",
  savedLine: "{a} → {b} · {p}% smaller", savedLineBigger: "{a} → {b}",
  convertingN: "Converting {n} files · {p}%", doneOf: "{d} of {n} done",
  waiting: "Waiting", waitingAhead: "Waiting · {n} ahead", statusDone: "Done", statusFailed: "Needs a hand",
  preview: "Preview", download: "Download", downloadAll: "Download all ({n} files, .zip)", downloadOne: "Download {x}",
  again: "Convert something else", fixRetry: "Skip damaged parts & retry", tryAgain: "Try again", showDetail: "Details", hideDetail: "Hide details",
  keepLonger: "Keep files for", shortcuts: "Shortcuts", recent: "Recent", seeAll: "See all", nothingYet: "Nothing yet — your conversions show up here.",
  server: "Server", running: "Running fine", yourSpace: "Space you're using", biggest: "Biggest file allowed",
  histSub: "Your conversions. Files delete themselves when their time runs out unless you keep them.",
  deletesIn: "Deletes in {x}", kept: "Kept", expired: "Expired", open: "Open", del: "Delete", keepForever: "Keep", stopKeeping: "Stop keeping",
  confirmDelete: "Delete this conversion and its files?",
  privacy: "Private: only you see your files. They delete themselves when the time you picked runs out.",
  login: "Log in", setup: "Create the first account", email: "Email", password: "Password", signIn: "Log in", createAccount: "Create account",
  badLogin: "That email and password don't match.", setupSub: "This account becomes the admin.", loginSub: "Use the account Jorge made for you.",
  photo: ["photo", "photos"], video: ["video", "videos"], audio: ["recording", "recordings"], pdf: ["PDF", "PDFs"], doc: ["document", "documents"], ebook: ["e-book", "e-books"], other: ["file", "files"],
  warnHevc: "{x} is HEVC — it won't play on some TVs and older phones. MP4 fixes that.",
  warnScan: "{x} is a scanned picture with no text inside. \"Text from scan\" will read the words for you.",
  paste: "Or paste a link (Google Drive, Dropbox, or a direct file link)", fetch: "Get it", fetching: "Getting…",
  downloadingPct: "Getting from link {pct}%", downloadingAmt: "Getting from link · {x}",
  shareTitle: "Share", makeLink: "Make a link", newLink: "New link", copy: "Copy", copied: "Copied!", stopSharing: "Stop sharing",
  linkWorks: "Link works for", shareChoice_24h: "Works for 24 hours", shareChoice_3d: "Works for 3 days", shareChoice_7d: "Works for 7 days", shareChoice_once: "One download only",
  shareOnce: "One download only", shareUntil: "Works until {x}",
  phone: "Get it on your phone", phoneSub: "Point your phone's camera here to download.", qrLabel: "QR code for the share link",
  warnGps: "{n} photos have location data. It's removed by default when you convert.",
  scHeic: "iPhone photos → JPG", scHeicD: "Removes location, keeps date", scWa: "Video for WhatsApp", scWaD: "MP4 under 100 MB",
  scPdf: "Photos into one PDF", scPdfD: "For forms and paperwork", scMp3: "Video → MP3", scMp3D: "Keep just the sound",
  min: "about {n} min", sec: "about {n} seconds", left: "about {x} left",
  pages: "{n} pages", hasText: "has text", scanned: "scanned, no text", hasLocation: "has location",
};

const ES = {
  myAccount: "Mi cuenta", adminPage: "Administrar servidor", guestAccount: "Cuenta de invitado", guestUntil: "hasta {x}",
  loginDisabled: "Esta cuenta está desactivada. Avísale a Jorge.", loginExpired: "Esta cuenta de invitado venció. Pídele a Jorge una nueva invitación.",
  inviteGone: "Esta invitación venció", inviteGoneSub: "Pídele un nuevo enlace a quien te la mandó.",
  joinTitle: "Estás invitado", joinSub: "Crea tu cuenta para empezar a convertir archivos.", joinGuest: "Es una cuenta de invitado que dura {n} días; después se borra junto con sus archivos.",
  yourName: "Tu nombre", pwHint: "Al menos 8 caracteres.", save: "Guardar", saved: "Guardado", pwChanged: "Contraseña cambiada",
  storage: "Espacio", storageHint: "Cuentan los originales y los resultados. Borra conversiones viejas en Historial para liberar espacio.",
  notifications: "Avisos", connected: "Conectado", notifyDone: "Avísame cuando termine una conversión larga", notifyDoneHint: "Así puedes cerrar la página y volver luego",
  disconnect: "Desconectar Telegram", tgWhy: "Recibe un mensaje de Telegram cuando tus archivos estén listos.", tgConnect: "Conectar Telegram", tgWaiting: "Esperando a Telegram… toca Iniciar allá",
  tgConnected: "¡Telegram conectado!", tgNotSetUp: "Los avisos de Telegram aún no están configurados en este servidor.",
  changePw: "Cambiar contraseña", currentPw: "Contraseña actual", newPw: "Contraseña nueva",
  history: "Historial", newConversion: "+ Nueva conversión", account: "Cuenta", logout: "Cerrar sesión", classic: "ConvertX clásico",
  theme: "Tema", dark: "Oscuro", light: "Claro", auto: "Auto", themeNote: "Se guarda en este dispositivo. Auto sigue el modo claro/oscuro de tu dispositivo.",
  steps: ["Agregar", "Elegir", "Descargar"],
  h1: "Cambia cualquier archivo al formato que necesites.", sub: "Fotos, videos, documentos, notas de voz — todo a la vez.",
  drop: "Suelta tus archivos aquí", dropMore: "Suelta más archivos aquí", dropSub: "o toca para elegir · hasta {max} cada uno",
  dropAnywhere: "Suelta para agregar", removeAll: "Quitar todo", next: "Siguiente: elegir formatos",
  uploading: "Subiendo {pct}%", checking: "Revisando…", uploadFailed: "Falló la subida", retry: "Reintentar", remove: "Quitar",
  whatDo: "¿En qué los convertimos?", chooseSub: "Ordenamos tus {n} archivos por tipo. La mejor opción ya está elegida — cambia lo que quieras.",
  best: "Mejor", change: "Cambiar", done: "Listo", settingsFor: "Ajustes para {x} — cambian si eliges otro formato.",
  techShow: "Detalles técnicos", techHide: "Ocultar detalles técnicos",
  perFile: "Elegir por archivo ({n})", perFileDone: "Terminar", sameAsGroup: "Igual que el grupo ({x})", setSeparately: "{n} con otro formato",
  otherShow: "Otros formatos ({n} más)", otherHide: "Ocultar otros formatos", otherNone: "No hay otros formatos para este tipo.", showAllN: "Mostrar los {n}",
  onlyOther: "Elige un formato para estos archivos:",
  back: "Atrás", convertN: "Convertir {n} archivos", convert1: "Convertir 1 archivo", waitUploads: "Esperando subidas ({n})",
  youGet: "Lo que vas a recibir", before: "Antes", after: "Después (aprox.)", time: "Tiempo", queue: "Fila",
  queueFree: "Empieza de inmediato", queueBusy: "{n} antes que tú", keepFor: "Guardar mis archivos por",
  keep: ["24 horas", "3 días", "7 días", "Hasta que los borre"],
  working: "Trabajando…", workingSub: "Puedes cerrar esta página — tus archivos se siguen convirtiendo. Encuéntralos luego en Historial.",
  allReady: "Tus {n} archivos están listos", someReady: "{d} de {n} listos — {f} necesitan ayuda",
  savedLine: "{a} → {b} · {p}% más pequeño", savedLineBigger: "{a} → {b}",
  convertingN: "Convirtiendo {n} archivos · {p}%", doneOf: "{d} de {n} listos",
  waiting: "En espera", waitingAhead: "En espera · {n} antes", statusDone: "Listo", statusFailed: "Necesita ayuda",
  preview: "Ver", download: "Descargar", downloadAll: "Descargar todo ({n} archivos, .zip)", downloadOne: "Descargar {x}",
  again: "Convertir otra cosa", fixRetry: "Saltar partes dañadas y reintentar", tryAgain: "Reintentar", showDetail: "Detalles", hideDetail: "Ocultar detalles",
  keepLonger: "Guardar archivos por", shortcuts: "Atajos", recent: "Recientes", seeAll: "Ver todo", nothingYet: "Nada todavía — tus conversiones aparecen aquí.",
  server: "Servidor", running: "Funcionando bien", yourSpace: "Espacio que usas", biggest: "Archivo más grande permitido",
  histSub: "Tus conversiones. Los archivos se borran solos cuando pasa su tiempo, a menos que los guardes.",
  deletesIn: "Se borra en {x}", kept: "Guardado", expired: "Vencido", open: "Abrir", del: "Borrar", keepForever: "Guardar", stopKeeping: "No guardar",
  confirmDelete: "¿Borrar esta conversión y sus archivos?",
  privacy: "Privado: solo tú ves tus archivos. Se borran solos cuando pasa el tiempo elegido.",
  login: "Iniciar sesión", setup: "Crea la primera cuenta", email: "Correo", password: "Contraseña", signIn: "Entrar", createAccount: "Crear cuenta",
  badLogin: "El correo y la contraseña no coinciden.", setupSub: "Esta cuenta será la de administrador.", loginSub: "Usa la cuenta que Jorge te creó.",
  photo: ["foto", "fotos"], video: ["video", "videos"], audio: ["grabación", "grabaciones"], pdf: ["PDF", "PDFs"], doc: ["documento", "documentos"], ebook: ["libro", "libros"], other: ["archivo", "archivos"],
  warnHevc: "{x} es HEVC — no se reproduce en algunas TVs y teléfonos viejos. MP4 lo arregla.",
  warnScan: "{x} es una imagen escaneada sin texto. \"Texto del escaneo\" leerá las palabras por ti.",
  paste: "O pega un enlace (Google Drive, Dropbox o un enlace directo)", fetch: "Traer", fetching: "Trayendo…",
  downloadingPct: "Trayendo del enlace {pct}%", downloadingAmt: "Trayendo del enlace · {x}",
  shareTitle: "Compartir", makeLink: "Crear enlace", newLink: "Nuevo enlace", copy: "Copiar", copied: "¡Copiado!", stopSharing: "Dejar de compartir",
  linkWorks: "El enlace sirve por", shareChoice_24h: "Sirve por 24 horas", shareChoice_3d: "Sirve por 3 días", shareChoice_7d: "Sirve por 7 días", shareChoice_once: "Una sola descarga",
  shareOnce: "Una sola descarga", shareUntil: "Sirve hasta {x}",
  phone: "Llévalo a tu teléfono", phoneSub: "Apunta la cámara de tu teléfono aquí para descargar.", qrLabel: "Código QR del enlace",
  warnGps: "{n} fotos tienen ubicación. Se quita por defecto al convertir.",
  scHeic: "Fotos de iPhone → JPG", scHeicD: "Quita la ubicación, guarda la fecha", scWa: "Video para WhatsApp", scWaD: "MP4 de menos de 100 MB",
  scPdf: "Fotos en un PDF", scPdfD: "Para formularios y trámites", scMp3: "Video → MP3", scMp3D: "Solo el sonido",
  min: "unos {n} min", sec: "unos {n} segundos", left: "faltan {x}",
  pages: "{n} páginas", hasText: "tiene texto", scanned: "escaneado, sin texto", hasLocation: "tiene ubicación",
};

// Recipe and setting text lives in recipes.ts in English; Spanish overrides by exact string.
const ES_RECIPE = {
  "Text from scan": "Texto del escaneo", "Reads the words on scanned pages so you can copy them.": "Lee las palabras de páginas escaneadas para que las copies.",
  "Searchable PDF": "PDF con búsqueda", "Same pages, but you can search and copy the text.": "Las mismas páginas, pero puedes buscar y copiar el texto.",
  "Text from photo": "Texto de la foto", "Reads the words in a photo of a document or sign.": "Lee las palabras en la foto de un documento o letrero.",
  Subtitles: "Subtítulos", "An .srt file with what's said, timed to the video.": "Un archivo .srt con lo que se dice, sincronizado con el video.",
  Transcript: "Transcripción", "Types out everything that's said.": "Escribe todo lo que se dice.", "Types out what's said, in Spanish or English.": "Escribe lo que se dice, en español o inglés.",
  "Language on the page": "Idioma del texto", "English + Spanish": "Inglés + español", English: "Inglés", Spanish: "Español",
  "Straighten crooked pages": "Enderezar páginas chuecas", "Fixes tilted phone scans": "Arregla escaneos torcidos del teléfono", "pages straightened": "páginas enderezadas",
  "Language spoken": "Idioma hablado", "Detect automatically": "Detectar solo", "Include timestamps": "Incluir tiempos", "Shows when each line was said": "Muestra cuándo se dijo cada línea", "with timestamps": "con tiempos",
  "Opens on every phone, computer and website.": "Se abre en cualquier teléfono, computadora o página web.",
  "One PDF": "Un PDF", "All photos in one document, in order.": "Todas las fotos en un documento, en orden.",
  "Highest quality, much larger files.": "La mejor calidad, archivos mucho más grandes.",
  "Smallest files for sharing online.": "Los archivos más pequeños para compartir.",
  "Plays on phones, every TV and in WhatsApp.": "Se ve en teléfonos, cualquier TV y WhatsApp.",
  "For WhatsApp": "Para WhatsApp", "Under 100 MB, still looks good.": "Menos de 100 MB y se ve bien.",
  "Just the sound": "Solo el sonido", "Saves the audio as an MP3.": "Guarda el audio como MP3.",
  "Animated GIF": "GIF animado", "Short, silent loop for chats.": "Un clip corto sin sonido para chats.",
  "Plays anywhere, including the car.": "Suena en todos lados, hasta en el carro.",
  "Best for iPhone and Apple Music.": "Ideal para iPhone y Apple Music.", "Uncompressed, for editing.": "Sin comprimir, para editar.",
  "Smaller PDF": "PDF más pequeño", "Same pages, easier to email.": "Las mismas páginas, más fácil de enviar.",
  "Word document": "Documento de Word", "Editable DOCX. Works best on PDFs with real text.": "DOCX editable. Funciona mejor con PDFs que tienen texto.",
  "Pictures": "Imágenes", "One JPG per page, zipped together.": "Un JPG por página, en un .zip.",
  "Plain text": "Texto simple", "Just the words, for copying.": "Solo las palabras, para copiar.",
  "Looks the same everywhere, easy to print and send.": "Se ve igual en todos lados, fácil de imprimir y enviar.",
  "Opens in Word and Google Docs.": "Se abre en Word y Google Docs.", "Just the words, no formatting.": "Solo las palabras, sin formato.",
  "Apple Books, Kobo, most e-readers.": "Apple Books, Kobo y la mayoría de lectores.", "AZW3 for Kindle devices and apps.": "AZW3 para Kindle.",
  "Fixed pages for printing.": "Páginas fijas para imprimir.", "Picked from all formats.": "Elegido de todos los formatos.",
  Quality: "Calidad", Smaller: "Más pequeño", Balanced: "Equilibrado", Best: "Mejor", " quality": "",
  Size: "Tamaño", "Original size": "Tamaño original", "Max 2048 px — sharing": "Máx. 2048 px — compartir", "Max 1080 px — social": "Máx. 1080 px — redes",
  "Remove location": "Quitar ubicación", "No one can see where photos were taken": "Nadie puede ver dónde se tomaron las fotos",
  "Keep date taken": "Guardar la fecha", "Photos stay in order in your gallery": "Las fotos quedan en orden en tu galería",
  "location removed": "sin ubicación", "location kept": "con ubicación", "date removed": "sin fecha",
  "Page size": "Tamaño de página", "Fit each photo": "Al tamaño de cada foto", Order: "Orden", "As added": "Como se agregaron", "By file name": "Por nombre",
  Resolution: "Resolución", "Keep original": "Original", "1080p — TVs and phones": "1080p — TVs y teléfonos", "720p — smaller": "720p — más pequeño",
  "Play on any TV": "Que se vea en cualquier TV", "Converts HEVC to H.264, which everything supports": "Convierte HEVC a H.264, que todo soporta",
  "plays on any TV": "se ve en cualquier TV", "keeps HEVC": "mantiene HEVC", "Trim (start to end)": "Recortar (inicio a fin)",
  "Sized automatically to stay under WhatsApp's 100 MB limit. Long videos get a lower resolution.": "Se ajusta solo para quedar bajo el límite de 100 MB de WhatsApp. Los videos largos bajan de resolución.",
  "Sound quality": "Calidad del sonido", Normal: "Normal", High: "Alta", " sound": "",
  "Even out the volume": "Emparejar el volumen", "Quiet parts get louder, loud parts softer": "Lo bajo sube, lo alto baja", "volume evened out": "volumen emparejado",
  Width: "Ancho", " wide": "", Smoothness: "Fluidez",
  "Reduce background noise": "Reducir ruido de fondo", "Removes hum and hiss": "Quita zumbidos y siseos", "noise reduced": "sin ruido",
  Compression: "Compresión", Strong: "Fuerte", Light: "Ligera", " compression": "",
  Sharpness: "Nitidez", Screen: "Pantalla", Print: "Impresión", " sharpness": "",
  "Keep the layout": "Mantener el diseño", "Keeps columns and spacing instead of one long flow": "Mantiene columnas y espacios", "layout kept": "con diseño",
  "Converted with the standard converter for this format — there's nothing to adjust.": "Se convierte con el convertidor estándar — no hay nada que ajustar.",
};

let lang = "en";
try {
  lang = localStorage.getItem("cx-lang") || (navigator.language || "en").slice(0, 2);
} catch {
  /* default */
}
if (lang !== "es") lang = "en";

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = l === "es" ? "es" : "en";
  try {
    localStorage.setItem("cx-lang", lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
}

export function t(key, vars) {
  const dict = lang === "es" ? ES : EN;
  let s = dict[key] ?? EN[key] ?? key;
  if (typeof s === "string" && vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function tr(s) {
  if (lang !== "es" || s == null) return s;
  return ES_RECIPE[s] ?? s;
}

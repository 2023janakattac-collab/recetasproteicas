// Referencias a los elementos del DOM
const zonaDeChat = document.getElementById("zona-de-chat");
const zonaDeEscritura = document.getElementById("zona-de-escritura");
const campoMensaje = document.getElementById("campo-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const estadoVisual = document.getElementById("estado-visual");
const contadorCaracteres = document.getElementById("contador-caracteres");

// Constantes de control
const LIMITE_CARACTERES = 500;
const TIEMPO_LIMITE_MS = 30000;
const PAUSA_MINIMA_MS = 1500;
const CLAVE_SESION = "recetas_proteicas_session_id";

// Variables de estado en memoria
let sessionIdMemoria = null;
let esperandoRespuesta = false;
let ultimoEnvioTimestamp = 0;

/**
 * Obtiene o genera un identificador de sesión único y lo persiste.
 */
function obtenerSessionId() {
  try {
    const guardado = localStorage.getItem(CLAVE_SESION);
    if (guardado) {
      return guardado;
    }
  } catch (error) {
    // Si localStorage está bloqueado, se usa respaldo en memoria
  }

  if (sessionIdMemoria) {
    return sessionIdMemoria;
  }

  const nuevoId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  sessionIdMemoria = nuevoId;

  try {
    localStorage.setItem(CLAVE_SESION, nuevoId);
  } catch (error) {
    // Continuar con sessionIdMemoria si falla el almacenamiento
  }

  return nuevoId;
}

const sessionId = obtenerSessionId();

/**
 * Actualiza el indicador visual de estado en la zona de escritura.
 */
function actualizarEstado(tipo, texto) {
  estadoVisual.textContent = texto;
  estadoVisual.className = "estado-visual";

  if (tipo === "cargando") {
    estadoVisual.classList.add("estado-cargando");
  } else if (tipo === "exito") {
    estadoVisual.classList.add("estado-exito");
  } else if (tipo === "error") {
    estadoVisual.classList.add("estado-error");
  }
}

/**
 * Habilita o deshabilita los controles de escritura.
 */
function alternarControles(deshabilitado) {
  campoMensaje.disabled = deshabilitado;
  botonEnviar.disabled = deshabilitado;
}

/**
 * Agrega una burbuja de mensaje en la zona de chat usando solo textContent.
 */
function agregarMensajeAlChat(remitente, texto, esError = false) {
  const burbuja = document.createElement("div");
  burbuja.classList.add("burbuja");

  if (esError) {
    burbuja.classList.add("burbuja-error");
  } else if (remitente === "usuario") {
    burbuja.classList.add("burbuja-usuario");
  } else {
    burbuja.classList.add("burbuja-agente");
  }

  const etiquetaAutor = document.createElement("span");
  etiquetaAutor.classList.add("autor");
  etiquetaAutor.textContent =
    remitente === "usuario" ? "Vos" : esError ? "Aviso" : "Recetas Proteicas";

  const parrafoTexto = document.createElement("p");
  parrafoTexto.classList.add("texto-mensaje");
  parrafoTexto.textContent = texto;

  burbuja.appendChild(etiquetaAutor);
  burbuja.appendChild(parrafoTexto);
  zonaDeChat.appendChild(burbuja);

  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

/**
 * Procesa el texto devuelto por el webhook siguiendo las reglas de contrato.
 */
function procesarTextoRespuesta(textoCrudo) {
  if (!textoCrudo || textoCrudo.trim() === "") {
    return "(respuesta vacía)";
  }

  try {
    const datos = JSON.parse(textoCrudo);
    if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
      const propiedadesPrioridad = ["response", "respuesta", "message", "mensaje"];
      for (const clave of propiedadesPrioridad) {
        if (typeof datos[clave] === "string" && datos[clave].trim() !== "") {
          return datos[clave];
        }
      }
      return "Make respondió, pero sin el campo response";
    }
    return textoCrudo;
  } catch (error) {
    // Si no es JSON válido, se devuelve el texto tal cual
    return textoCrudo;
  }
}

/**
 * Verifica si la URL del webhook está configurada correctamente.
 */
function webhookConfigurado() {
  if (typeof WEBHOOK_URL !== "string") {
    return false;
  }
  const urlLimpia = WEBHOOK_URL.trim();
  return urlLimpia !== "" && !urlLimpia.includes("ACA VA");
}

/**
 * Envía el mensaje al webhook de Make con control de tiempo límite y estados.
 */
async function enviarMensajeAlAgente(mensajeTexto) {
  if (!webhookConfigurado()) {
    agregarMensajeAlChat(
      "agente",
      "Falta pegar la URL de tu webhook en config.js",
      true
    );
    actualizarEstado("error", "Falta configurar config.js");
    return;
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);

  esperandoRespuesta = true;
  alternarControles(true);
  actualizarEstado("cargando", "Buscando recetas proteicas...");

  try {
    const cuerpoPeticion = JSON.stringify({
      sessionId: sessionId,
      mensaje: mensajeTexto,
      fecha: new Date().toISOString()
    });

    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: cuerpoPeticion,
      signal: controlador.signal
    });

    const textoRespuesta = await respuesta.text();

    if (!respuesta.ok) {
      const mensajeHttp = `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`;
      agregarMensajeAlChat("agente", mensajeHttp, true);
      actualizarEstado("error", `Error HTTP ${respuesta.status}`);
      return;
    }

    const respuestaFinal = procesarTextoRespuesta(textoRespuesta);
    agregarMensajeAlChat("agente", respuestaFinal, false);
    actualizarEstado("exito", "Respuesta recibida");
  } catch (error) {
    if (error.name === "AbortError") {
      agregarMensajeAlChat(
        "agente",
        "La solicitud tardó más de 30 segundos y fue cancelada. Intentá de nuevo.",
        true
      );
      actualizarEstado("error", "Tiempo agotado");
    } else {
      agregarMensajeAlChat(
        "agente",
        "Error de red al intentar conectar con el servidor. Verificá tu conexión.",
        true
      );
      actualizarEstado("error", "Error de red");
    }
  } finally {
    clearTimeout(temporizador);
    esperandoRespuesta = false;
    alternarControles(false);
    campoMensaje.focus();
  }
}

// Actualiza el contador de caracteres en tiempo real
campoMensaje.addEventListener("input", () => {
  if (campoMensaje.value.length > LIMITE_CARACTERES) {
    campoMensaje.value = campoMensaje.value.slice(0, LIMITE_CARACTERES);
  }
  contadorCaracteres.textContent = `${campoMensaje.value.length} / ${LIMITE_CARACTERES}`;
});

// Maneja el envío del formulario
zonaDeEscritura.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (esperandoRespuesta) {
    return;
  }

  const ahora = Date.now();
  if (ahora - ultimoEnvioTimestamp < PAUSA_MINIMA_MS) {
    actualizarEstado("error", "Esperá un instante antes de volver a enviar");
    return;
  }

  const textoLimpio = campoMensaje.value.trim();

  if (textoLimpio === "") {
    return;
  }

  if (textoLimpio.length > LIMITE_CARACTERES) {
    actualizarEstado("error", "El mensaje supera los 500 caracteres");
    return;
  }

  ultimoEnvioTimestamp = ahora;
  agregarMensajeAlChat("usuario", textoLimpio, false);

  campoMensaje.value = "";
  contadorCaracteres.textContent = `0 / ${LIMITE_CARACTERES}`;

  await enviarMensajeAlAgente(textoLimpio);
});

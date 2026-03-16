import OpenAI from "openai";
import { WebSocketServer } from "ws";
import http from "http";

const PORT     = process.env.PORT         || 8080;
const GROQ_KEY = process.env.GROQ_API_KEY;

if (!GROQ_KEY) {
  console.error("[FATAL] GROQ_API_KEY no configurada");
  process.exit(1);
}

const groq = new OpenAI({
  apiKey:  GROQ_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const SYSTEM_PROMPT = [
  "Eres la asistente virtual de Maria Jesus Montero, candidata del PSOE a la Presidencia de la Junta de Andalucia.",
  "Tienes su manera de hablar y debes identificarte siempre como su asistente de IA.",
  "",
  "IDIOMAS Y TRATAMIENTO - MUY IMPORTANTE:",
  "- Habla SIEMPRE en espanol de Espana.",
  "- Tutea siempre usando TU. NUNCA uses vos ni formas rioplatenses ni latinoamericanas.",
  "",
  "PERSONALIDAD Y TONO:",
  "- Calida, cercana y directa, como Maria Jesus en sus apariciones publicas.",
  "- Expresiones naturales: mira, fijate, la verdad es que, desde luego, anda, venga, a que si.",
  "- Maximo 3-4 frases por turno.",
  "- Escucha activa: reconoce lo que el ciudadano ha dicho antes de responder.",
  "- Cuando no sabe algo: ese es un tema que Maria Jesus tiene muy presente, lo traslado a su equipo.",
  "",
  "ACENTO ANDALUZ NATURAL - SIN EXAGERAR:",
  "Leve acento sevillano natural. Usa con moderacion: mu bien, pa que te enteres, venga va.",
  "NO elimines todas las eses. Habla como Maria Jesus en television: andaluza pero comprensible.",
  "",
  "SOBRE MARIA JESUS MONTERO:",
  "- Sevillana, medica, ex-Consejera de Salud y Hacienda de la Junta de Andalucia.",
  "- Actual Vicepresidenta Primera del Gobierno de Espana y Ministra de Hacienda.",
  "- Frase central: No vuelvo porque nunca me marche.",
  "",
  "PROPUESTAS:",
  "SANIDAD: recuperar listas de espera, reforzar atencion primaria, acabar con escandalo de cribados de cancer, mas plazas MIR.",
  "VIVIENDA: parque publico asequible para jovenes, regular alquiler turistico en Malaga, Sevilla y Costa del Sol.",
  "EMPLEO: energias renovables en empleo de calidad, apoyo al campo andaluz, hidrogeno verde.",
  "EDUCACION: mas recursos para escuela publica, FP ligada al mercado laboral real.",
  "FINANCIACION: Andalucia recibe menos de lo que aporta, MJM conoce el sistema desde dentro.",
  "AGUA: plan hidrologico para la sequia del sur, ferrocarriles regionales modernizados.",
  "",
  "FLUJO:",
  "1. Escucha sin interrumpir.",
  "2. Reconocer el tema del ciudadano.",
  "3. Conectar con la propuesta brevemente.",
  "4. Preguntar: Hay algo mas que quieras que le transmita?",
  "5. Cierre: muchas gracias por tomarte este tiempo. Lo que me has contado se lo traslado a Maria Jesus. Venga, hasta pronto!",
  "",
  "SITUACIONES ESPECIALES:",
  "Si preguntan si es IA: Si, soy la asistente virtual de Maria Jesus, una IA con su programa. Ella me ha puesto aqui para que ningun andaluz se quede sin ser escuchado.",
  "Si critican al PSOE: Entiendo que hay cosas del pasado que generan desconfianza. Maria Jesus lo sabe. Por eso vuelve, no para hacer lo mismo, sino para hacerlo diferente.",
  "Si no saben por quien votar: Esta bien no tenerlo claro. Maria Jesus viene a escuchar, no a imponer. Esta llamada es la prueba.",
  "",
  "NUNCA: usar vos, hablar mal de otros partidos, prometer favores concretos, exagerar el acento, responder con listas."
].join("\n");

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mjm-custom-llm", llm: "groq/llama-3.3-70b" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log("[WS] Conexion - " + ip);

  ws.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      console.error("[WS] JSON invalido");
      return;
    }

    const { interaction_type, transcript = [], response_id, call } = payload;

    if (interaction_type !== "response_required" && interaction_type !== "reminder_required") {
      console.log("[WS] ignorando interaction_type: " + interaction_type);
      return;
    }

    console.log("[WS] response_id=" + response_id + " | turns=" + transcript.length);

    const dynVars  = (call && call.retell_llm_dynamic_variables) || {};
    const userName = dynVars.user_first_name || "";
    const userProv = dynVars.user_provincia  || "";

    // ── DETECTAR SI ES EL PRIMER TURNO DEL AGENTE ────────────────────────────
    // Si no hay ningún turno previo del agente en el transcript, es la primera respuesta
    const agentHasSpoken = transcript.some((t) => t.role === "agent");

    let systemWithContext = SYSTEM_PROMPT;
    if (userName || userProv) {
      systemWithContext += "\n\nDATOS DEL CIUDADANO:";
      if (userName) systemWithContext += "\n- Nombre: " + userName;
      if (userProv) systemWithContext += "\n- Provincia: " + userProv;
      systemWithContext += "\nUsa el nombre de forma natural a lo largo de la conversacion.";
    }

    const messages = transcript.map((turn) => ({
      role:    turn.role === "agent" ? "assistant" : "user",
      content: turn.content,
    }));

    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "Hola" });
    }

    // Si el agente no ha hablado aun, instruir a Groq para que empiece con la bienvenida
    if (!agentHasSpoken) {
      const nombrePart = userName ? ", " + userName : ", vecino";
      systemWithContext += "\n\nIMPORTANTE - PRIMERA RESPUESTA: Empieza EXACTAMENTE con esta bienvenida antes de responder a lo que dijo el usuario: "
        + "Hola" + nombrePart + ". Soy la asistente virtual de Maria Jesus Montero, su voz digital de campana. "
        + "Maria Jesus me ha pedido que este aqui para escuchar lo que preocupa a los andaluces. "
        + "Todo lo que me cuentes llegara a ella y a su equipo. "
        + "Despues de la bienvenida, responde brevemente a lo que acaba de decir el ciudadano si ha dicho algo relevante.";
    }

    try {
      const stream = await groq.chat.completions.create({
        model:    "llama-3.3-70b-versatile",
        max_tokens: 150,
        stream:   true,
        messages: [{ role: "system", content: systemWithContext }, ...messages],
      });

      let fullText = "";

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
          fullText += text;
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ response_id, content: text, content_complete: false, end_call: false }));
          }
        }
      }

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ response_id, content: "", content_complete: true, end_call: false }));
      }

      console.log("[WS] OK response_id=" + response_id + " | " + fullText.length + " chars");

    } catch (err) {
      console.error("[Groq] Error: " + err.message);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ response_id, content: "Disculpa, ha habido un problema tecnico. Me repites lo que me estabas contando?", content_complete: true, end_call: false }));
      }
    }
  });

  ws.on("close", () => console.log("[WS] Desconectado - " + ip));
  ws.on("error", (e) => console.error("[WS] Error - " + e.message));
});

httpServer.listen(PORT, () => {
  console.log("[Server] MJM Custom LLM (Groq) en puerto " + PORT);
});

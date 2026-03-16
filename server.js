import OpenAI from "openai";
import { WebSocketServer } from "ws";
import http from "http";

const PORT         = process.env.PORT         || 8080;
const GROQ_KEY     = process.env.GROQ_API_KEY;
const RETELL_KEY   = process.env.RETELL_API_KEY;
const RETELL_AGENT = process.env.RETELL_AGENT_ID || "agent_a25801dffab9265813be8c9422";

if (!GROQ_KEY)   { console.error("[FATAL] GROQ_API_KEY no configurada");   process.exit(1); }
if (!RETELL_KEY) { console.error("[FATAL] RETELL_API_KEY no configurada"); process.exit(1); }

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
  "- Maximo 3-4 frases por turno, las respuestas largas se pierden en audio.",
  "- Escucha activa: reconoce lo que el ciudadano ha dicho antes de responder.",
  "- Cuando no sabe algo: ese es un tema que Maria Jesus tiene muy presente, lo traslado directamente a su equipo.",
  "",
  "ACENTO ANDALUZ NATURAL - SIN EXAGERAR:",
  "Maria Jesus tiene un leve acento sevillano natural, no un acento de chiste.",
  "Usa con moderacion: mu bien, pa que te enteres, venga va.",
  "NO elimines todas las eses. Habla como Maria Jesus en television: andaluza pero completamente comprensible.",
  "",
  "SOBRE MARIA JESUS MONTERO:",
  "- Sevillana, medica de formacion, especialista en medicina preventiva.",
  "- Ex-Consejera de Salud y de Hacienda de la Junta de Andalucia.",
  "- Actual Vicepresidenta Primera del Gobierno de Espana y Ministra de Hacienda.",
  "- Frase central: No vuelvo porque nunca me marche.",
  "",
  "PROPUESTAS:",
  "SANIDAD: recuperar listas de espera, reforzar atencion primaria, acabar con el escandalo de cribados de cancer de mama, mas plazas MIR.",
  "VIVIENDA: parque publico asequible para jovenes, regular alquiler turistico en Malaga, Sevilla y Costa del Sol.",
  "EMPLEO: energias renovables en empleo de calidad, apoyo al campo andaluz, hidrogeno verde.",
  "EDUCACION: mas recursos para la escuela publica, FP ligada al mercado laboral real.",
  "FINANCIACION: Andalucia recibe menos de lo que aporta, MJM conoce el sistema desde dentro.",
  "AGUA: plan hidrologico para la sequia del sur, ferrocarriles regionales modernizados.",
  "",
  "FLUJO DE CONVERSACION:",
  "1. Escucha sin interrumpir.",
  "2. Reconocer: Entiendo lo que me dices sobre [TEMA], es algo que Maria Jesus tiene muy presente...",
  "3. Conectar con la propuesta brevemente.",
  "4. Preguntar: Hay algo mas que quieras que le transmita?",
  "5. Cierre: [nombre], muchas gracias por tomarte este tiempo. Lo que me has contado se lo traslado directamente a Maria Jesus. Venga, hasta pronto!",
  "",
  "SITUACIONES ESPECIALES:",
  "Si preguntan si es IA: Si, soy la asistente virtual de Maria Jesus, una IA con su voz y su programa. Ella me ha puesto aqui para que ningun andaluz se quede sin ser escuchado.",
  "Si critican al PSOE: Entiendo que hay cosas del pasado que generan desconfianza. Maria Jesus lo sabe. Por eso vuelve, no para hacer lo mismo, sino para hacerlo diferente.",
  "Si no saben por quien votar: Esta bien no tenerlo claro todavia. Maria Jesus viene a escuchar, no a imponer. Esta llamada es la prueba.",
  "",
  "NUNCA:",
  "- Usar vos ni formas argentinas o latinoamericanas.",
  "- Hablar mal de otros partidos o candidatos.",
  "- Prometer trabajo, contratos o favores concretos.",
  "- Exagerar el acento hasta hacerlo incomprensible.",
  "- Responder con listas (es conversacion de voz)."
].join("\n");

function buildSaludo(userName) {
  const nombre = userName ? ", " + userName : "";
  return "Hola" + nombre + ". Soy la asistente virtual de Maria Jesus Montero, su voz digital de campana. Maria Jesus me ha pedido que este aqui para escuchar lo que preocupa a los andaluces. Todo lo que me cuentes llegara a ella y a su equipo. Que cosas te preocupan? Como puede Maria Jesus hacer que tu vida y la de tu familia sea cada dia un poco mejor?";
}

// ── HTTP SERVER ───────────────────────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {

  // CORS para el frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  // ── GET /health ─────────────────────────────────────────────────────────────
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mjm-llm" }));
    return;
  }

  // ── POST /call — proxy seguro hacia Retell ──────────────────────────────────
  if (req.url === "/call" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);

        const retellRes = await fetch("https://api.retellai.com/v2/create-web-call", {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": "Bearer " + RETELL_KEY,
          },
          body: JSON.stringify({
            agent_id: RETELL_AGENT,
            retell_llm_dynamic_variables: {
              user_first_name: data.nombre    || "",
              user_last_name:  data.apellido  || "",
              user_email:      data.email     || "",
              user_phone:      data.tel       || "",
              user_provincia:  data.provincia || "",
            },
            metadata: {
              nombre:   data.nombre,
              email:    data.email,
              tel:      data.tel,
              provincia: data.provincia,
            },
          }),
        });

        const json = await retellRes.json();
        if (!retellRes.ok) throw new Error("Retell " + retellRes.status + ": " + JSON.stringify(json));

        // Solo devolvemos lo que el frontend necesita — sin exponer la API key
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: json.access_token,
          call_id:      json.call_id,
        }));

      } catch (err) {
        console.error("[/call] Error: " + err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── GET /recording/:callId — proxy para grabaciones ─────────────────────────
  if (req.url && req.url.startsWith("/recording/") && req.method === "GET") {
    const callId = req.url.replace("/recording/", "").split("?")[0];
    try {
      const r = await fetch("https://api.retellai.com/v2/get-call/" + callId, {
        headers: { "Authorization": "Bearer " + RETELL_KEY }
      });
      const d = await r.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ recording_url: d.recording_url || null }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

// ── WEBSOCKET SERVER (Custom LLM para Retell) ─────────────────────────────────
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

    const dynVars  = (call && call.retell_llm_dynamic_variables) || {};
    const userName = dynVars.user_first_name || "";
    const userProv = dynVars.user_provincia  || "";

    // ── call_details: primer evento → enviamos saludo ─────────────────────────
    if (interaction_type === "call_details") {
      console.log("[WS] call_details → opening message");
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          response_id:      0,
          content:          buildSaludo(userName),
          content_complete: true,
          end_call:         false,
        }));
      }
      return;
    }

    if (interaction_type !== "response_required" && interaction_type !== "reminder_required") {
      return;
    }

    console.log("[WS] response_id=" + response_id + " | turns=" + transcript.length);

    let systemWithContext = SYSTEM_PROMPT;
    if (userName || userProv) {
      systemWithContext += "\n\nDATOS DEL CIUDADANO EN ESTA LLAMADA:";
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

    try {
      const stream = await groq.chat.completions.create({
        model:      "llama-3.3-70b-versatile",
        max_tokens: 120,
        stream:     true,
        messages:   [{ role: "system", content: systemWithContext }, ...messages],
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
  console.log("[Server] MJM LLM + Call Proxy en puerto " + PORT);
});

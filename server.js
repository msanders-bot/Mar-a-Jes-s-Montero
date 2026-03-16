import Anthropic from "@anthropic-ai/sdk";
import { WebSocketServer } from "ws";
import http from "http";

const PORT    = process.env.PORT             || 8080;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("[FATAL] ANTHROPIC_API_KEY no configurada");
  process.exit(1);
}

const claude = new Anthropic({ apiKey: API_KEY });

const SYSTEM_PROMPT = [
  "Eres la asistente virtual de Maria Jesus Montero, candidata del PSOE a la Presidencia de la Junta de Andalucia.",
  "Tienes su manera de hablar y debes identificarte siempre como su asistente de IA.",
  "",
  "APERTURA OBLIGATORIA al inicio de cada conversacion:",
  "Si tienes el nombre del usuario, di exactamente:",
  "Hola, [nombre]. Soy la asistente virtual de Maria Jesus Montero, su voz digital de campana. Maria Jesus me ha pedido que este aqui para escuchar lo que preocupa a los andaluces. Todo lo que me cuentes llegara a ella y a su equipo. Que cosas te preocupan? Como puede Maria Jesus hacer que tu vida y la de tu familia sea cada dia un poco mejor?",
  "Si NO tienes el nombre, sustituye por vecino o vecina segun corresponda.",
  "",
  "IDIOMAS Y TRATAMIENTO - MUY IMPORTANTE:",
  "- Habla SIEMPRE en espanol de Espana.",
  "- Tutea siempre usando TU. NUNCA uses vos ni formas rioplatenses ni latinoamericanas.",
  "- Si te sale una forma incorrecta como vos tenes o vos podes, corrigela a tu tienes o tu puedes.",
  "",
  "PERSONALIDAD Y TONO:",
  "- Calida, cercana y directa, como Maria Jesus en sus apariciones publicas.",
  "- Expresiones naturales que ella usa: mira, fijate, la verdad es que, desde luego, anda, venga, a que si.",
  "- Maximo 3-4 frases por turno, las respuestas largas se pierden en audio.",
  "- Escucha activa: reconoce lo que el ciudadano ha dicho antes de responder.",
  "- Cuando no sabe algo: ese es un tema que Maria Jesus tiene muy presente, lo traslado directamente a su equipo.",
  "",
  "ACENTO ANDALUZ NATURAL - SIN EXAGERAR:",
  "Maria Jesus tiene un leve acento sevillano natural, no un acento de chiste. Usa con moderacion: mu bien, pa que te enteres, venga va.",
  "NO elimines todas las eses ni escribas el texto foneticamente. Habla como habla Maria Jesus en television: andaluza pero completamente comprensible.",
  "",
  "SOBRE MARIA JESUS MONTERO:",
  "- Sevillana, medica de formacion, especialista en medicina preventiva.",
  "- Ex-Consejera de Salud y de Hacienda de la Junta de Andalucia.",
  "- Actual Vicepresidenta Primera del Gobierno de Espana y Ministra de Hacienda.",
  "- Frase central de su candidatura: No vuelvo porque nunca me marche.",
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
  "1. Apertura obligatoria con el nombre si lo tienes.",
  "2. Escucha sin interrumpir.",
  "3. Reconocer: Entiendo lo que me dices sobre [TEMA], es algo que Maria Jesus tiene muy presente...",
  "4. Conectar con la propuesta brevemente.",
  "5. Preguntar: Hay algo mas que quieras que le transmita?",
  "6. Cierre: [nombre], muchas gracias por tomarte este tiempo. Lo que me has contado se lo traslado directamente a Maria Jesus. Venga, hasta pronto!",
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

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mjm-custom-llm" }));
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
      return;
    }

    console.log("[WS] response_id=" + response_id + " | turns=" + transcript.length);

    const dynVars  = (call && call.retell_llm_dynamic_variables) || {};
    const userName = dynVars.user_first_name || "";
    const userProv = dynVars.user_provincia  || "";

    let systemWithContext = SYSTEM_PROMPT;
    if (userName || userProv) {
      systemWithContext += "\n\nDATOS DEL CIUDADANO EN ESTA LLAMADA:";
      if (userName) systemWithContext += "\n- Nombre: " + userName;
      if (userProv) systemWithContext += "\n- Provincia: " + userProv;
      systemWithContext += "\nUsa el nombre en la apertura y a lo largo de la conversacion de forma natural.";
    }

    const messages = transcript.map((turn) => ({
      role:    turn.role === "agent" ? "assistant" : "user",
      content: turn.content,
    }));

    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "Hola" });
    }

    try {
      const stream = await claude.messages.stream({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system:     systemWithContext,
        messages,
      });

      let fullText = "";

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta && chunk.delta.type === "text_delta") {
          const text = chunk.delta.text;
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
      console.error("[Claude] Error: " + err.message);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ response_id, content: "Disculpa, ha habido un problema tecnico. Me repites lo que me estabas contando?", content_complete: true, end_call: false }));
      }
    }
  });

  ws.on("close", () => console.log("[WS] Desconectado - " + ip));
  ws.on("error", (e) => console.error("[WS] Error - " + e.message));
});

httpServer.listen(PORT, () => {
  console.log("[Server] MJM Custom LLM en puerto " + PORT);
});

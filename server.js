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

const SYSTEM_PROMPT = "Eres la asistente virtual de Maria Jesus Montero, candidata del PSOE a la Presidencia de la Junta de Andalucia. Tienes su voz y su manera de hablar, pero debes identificarte siempre como su asistente de IA.\n\nAPERTURA OBLIGATORIA al inicio de cada conversacion:\nHola [nombre del usuario, o vecino/vecina si no lo tienes]. Soy la asistente virtual de Maria Jesus Montero, su voz digital de campana. Maria Jesus me ha pedido que este aqui para escuchar lo que preocupa a los andaluces. Todo lo que me cuentes llegara a ella y a su equipo. Que cosas te preocupan? Como puede Maria Jesus hacer que tu vida y la de tu familia sea cada dia un poco mejor?\n\nPERSONALIDAD:\n- Calidez y cercania de politica andaluza experimentada\n- Tutea siempre\n- Expresiones andaluzas: mira, fijate, la verdad es que, desde luego, anda, venga, a que si, sabes lo que te digo\n- Maximo 3-4 frases por turno, las respuestas largas se pierden en audio\n- Escucha activa: reconoce lo que el ciudadano ha dicho antes de responder\n\nACENTO ANDALUZ OBLIGATORIO - NUNCA castellano neutro:\n- Seseo: corazon -> corasón, hacer -> haser, veces -> veses\n- Elision de -s final: los ninos -> lo nino, mas bueno -> ma bueno\n- d intervocalica desaparece: todo -> too, nada -> na, lado -> lao\n- Mu en vez de muy: mu bien, mu importante\n- Pa en vez de para: pa que te entere, pa los andaluses\n- Na en vez de nada: na de na\nEjemplos: Las cosas estan muy avanzadas -> La cosa tan mu avanzas. Todo el mundo -> Too el mundo. No hay nada -> No hay na.\n\nSOBRE MARIA JESUS MONTERO:\n- Sevillana, medica de formacion, especialista en medicina preventiva\n- Ex-Consejera de Salud y de Hacienda de la Junta de Andalucia\n- Actual Vicepresidenta Primera del Gobierno de Espana y Ministra de Hacienda\n- Frase central: No vuelvo porque nunca me marche\n\nPROPUESTAS:\nSANIDAD: recuperar listas de espera, reforzar atencion primaria, acabar con escandalo de cribados de cancer de mama, mas plazas MIR.\nVIVIENDA: parque publico de vivienda asequible para jovenes, regular alquiler turistico en Malaga, Sevilla y Costa del Sol.\nEMPLEO: energias renovables en empleo de calidad, apoyo al campo andaluz, hidrogeno verde.\nEDUCACION: mas recursos para escuela publica, FP ligada al mercado laboral real.\nFINANCIACION: Andalucia recibe menos de lo que aporta, MJM conoce el sistema desde dentro.\nAGUA: plan hidrologico para la sequia del sur, ferrocarriles modernizados.\n\nFLUJO DE CONVERSACION:\n1. Apertura obligatoria\n2. Escucha sin interrumpir\n3. Reconocer: Entiendo lo que me dices sobre [TEMA]. Es algo que Maria Jesus tiene mu presente...\n4. Conectar con propuesta brevemente\n5. Preguntar: Hay algo mas que quieras que le transmita?\n6. Cierre: [nombre], muchas gracias por tomarte este tiempo. Lo que me has contao se lo traslado directamente a Maria Jesus. Venga va, hasta pronto!\n\nSITUACIONES ESPECIALES:\nSi preguntan si es IA: Si, soy la asistente virtual de Maria Jesus, una IA con su voz y su programa. Ella me ha puesto aqui pa que ningun andaluz se quede sin ser escuchao.\nSi critican al PSOE: Entiendo que hay cosas del pasao que generan desconfiansa. Maria Jesus lo sabe. Por eso vuelve, no pa hacer lo mismo, sino pa hacerlo diferente.\nSi no saben por quien votar: Esta bien no tenerlo claro todavia. Maria Jesus viene a escuchar, no a imponer. Esta llama es la prueba.\n\nNUNCA:\n- Hablar mal de otros partidos o candidatos\n- Prometer trabajo, contratos o favores concretos\n- Hablar en castellano neutro\n- Responder con listas (es conversacion de voz)";

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
      systemWithContext += "\nUsa estos datos para personalizar la conversacion de forma natural.";
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
        ws.send(JSON.stringify({ response_id, content: "Disculpa, ha habio un problemilla tecnico. Me repites lo que me tabas contando?", content_complete: true, end_call: false }));
      }
    }
  });

  ws.on("close", () => console.log("[WS] Desconectado - " + ip));
  ws.on("error", (e) => console.error("[WS] Error - " + e.message));
});

httpServer.listen(PORT, () => {
  console.log("[Server] MJM Custom LLM en puerto " + PORT);
});

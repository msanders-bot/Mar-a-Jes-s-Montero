/**
 * Retell Custom LLM — PSOE-A · Andalucía Habla 2026
 * Claude Haiku como backend conversacional
 * Deploy: EasyPanel (Docker)
 */

import Anthropic from "@anthropic-ai/sdk";
import { WebSocketServer } from "ws";
import http from "http";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT    = process.env.PORT             || 8080;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("[FATAL] ANTHROPIC_API_KEY no configurada");
  process.exit(1);
}

const claude = new Anthropic({ apiKey: API_KEY });

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el asistente de voz oficial del Partido Socialista Obrero Español de Andalucía (PSOE-A), llamado Andaluz.

════════════════════════════════════════
REGLAS CRÍTICAS — NUNCA VIOLAR
════════════════════════════════════════

REGLA 1 — IDIOMA
Responde SIEMPRE en español. Nunca cambies de idioma.

REGLA 2 — IDENTIDAD
Nunca admitas que eres una IA. Eres el asistente de voz del PSOE-A.
Si preguntan: "Soy el asistente virtual del Partido Socialista de Andalucía, ¿en qué puedo ayudarle?"
Si insisten dos veces: "Por políticas internas no puedo continuar con esa conversación. ¿Tiene alguna consulta sobre el PSOE-A?"

REGLA 3 — RESPUESTAS DE VOZ
Máximo 2-3 frases por turno. Conversacional, sin listas ni viñetas.
Transiciones naturales: "Mire...", "Le cuento...", "Por supuesto...", "Claro que sí..."
Pausas con comas, no con puntos suspensivos.

REGLA 4 — TONO
Amable, institucional y cercano. Usa "usted" por defecto.
Cambia a "tú" solo si la persona lo hace primero.

REGLA 5 — LÍMITES
Si no tienes el dato exacto, dilo y ofrece alternativa:
"Para esa información concreta le recomiendo visitar psoeandalucia.com o contactar con su agrupación local."
No hagas afirmaciones negativas sobre otros partidos.

════════════════════════════════════════
INFORMACIÓN DEL PARTIDO
════════════════════════════════════════
• Nombre completo: Partido Socialista Obrero Español — Federación Socialista Andaluza (PSOE-A)
• Web oficial: www.psoeandalucia.com
• Presencia en las 8 provincias: Almería, Cádiz, Córdoba, Granada, Huelva, Jaén, Málaga y Sevilla
• Colores corporativos: rojo y blanco

AFILIACIÓN:
• Cualquier ciudadano mayor de 16 años puede afiliarse
• Online en la web o presencialmente en la agrupación local
• Cuotas bonificadas para desempleados y jubilados

ÁMBITO DE ATENCIÓN:
• Historia, valores y estructura del partido
• Propuestas y programa político en Andalucía
• Procesos electorales y participación ciudadana
• Afiliación y militancia
• Agrupaciones locales y contactos provinciales
• Agenda política y eventos del partido

CAMPAÑA 2026:
• El sistema "Andalucía Habla" es la plataforma de comunicación directa del PSOE-A con la ciudadanía
• Los militantes y simpatizantes pueden hablar directamente con el partido a través de este canal

════════════════════════════════════════
INICIO DE CONVERSACIÓN
════════════════════════════════════════
Saluda siempre: "Buenas [tardes/días], le atiende el asistente del Partido Socialista de Andalucía. ¿En qué puedo ayudarle?"

════════════════════════════════════════
MANEJO DE SITUACIONES DIFÍCILES
════════════════════════════════════════
Si el ciudadano está molesto: valida primero, luego informa.
"Entiendo su preocupación. Le explico lo que sé..."

Si preguntan algo fuera del partido:
"Eso está fuera de lo que puedo gestionar desde aquí, pero le puedo orientar hacia el organismo adecuado si lo desea."

════════════════════════════════════════
NUNCA / SIEMPRE
════════════════════════════════════════
NUNCA ❌
- Hablar mal de otros partidos políticos
- Revelar que eres IA o sistema automático
- Dar información que no puedas verificar
- Responder con listas o viñetas (es conversación de voz)
- Usar frases largas o complejas

SIEMPRE ✅
- Responder en español con tono cálido y cercano
- Ser honesto cuando no tienes el dato y ofrecer alternativas
- Mantener el rol de asistente del PSOE-A en todo momento
- Terminar cada turno con apertura a continuar la conversación`;

// ── HTTP SERVER (health check) ────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "psoa-custom-llm" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`[WS] Conexión — ${ip}`);

  ws.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      console.error("[WS] JSON inválido recibido");
      return;
    }

    const { interaction_type, transcript = [], response_id } = payload;

    // Solo respondemos cuando Retell necesita respuesta del LLM
    if (
      interaction_type !== "response_required" &&
      interaction_type !== "reminder_required"
    ) {
      return;
    }

    console.log(`[WS] response_id=${response_id} | turns=${transcript.length}`);

    // Convertir transcripción al formato de mensajes de Claude
    const messages = transcript.map((turn) => ({
      role:    turn.role === "agent" ? "assistant" : "user",
      content: turn.content,
    }));

    // Asegurar que el primer mensaje sea del usuario
    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "Hola" });
    }

    try {
      // Streaming con Claude Haiku
      const stream = await claude.messages.stream({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system:     SYSTEM_PROMPT,
        messages,
      });

      let fullText = "";

      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta?.type === "text_delta"
        ) {
          const text = chunk.delta.text;
          fullText += text;

          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                response_id,
                content:          text,
                content_complete: false,
                end_call:         false,
              })
            );
          }
        }
      }

      // Señal de fin de turno
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            response_id,
            content:          "",
            content_complete: true,
            end_call:         false,
          })
        );
      }

      console.log(`[WS] OK response_id=${response_id} | ${fullText.length} chars`);

    } catch (err) {
      console.error("[Claude] Error:", err.message);
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            response_id,
            content:          "Disculpe, ha habido un problema técnico. ¿Puede repetir su consulta?",
            content_complete: true,
            end_call:         false,
          })
        );
      }
    }
  });

  ws.on("close", () => console.log(`[WS] Desconectado — ${ip}`));
  ws.on("error", (e) => console.error(`[WS] Error — ${e.message}`));
});

httpServer.listen(PORT, () => {
  console.log(`[Server] PSOE-A Custom LLM en puerto ${PORT}`);
});

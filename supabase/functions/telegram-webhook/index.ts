// Edge Function: telegram-webhook
//
// Chamada pelo Telegram (não pelo client) a cada update do bot — mensagens
// e cliques em botão inline. Sem verify_jwt (o Telegram não manda JWT
// nosso); protegida pelo header secreto que o próprio Telegram devolve em
// todo update quando o webhook é registrado com "secret_token" (ver
// setTelegramWebhook.ts / passo de configuração no README da função).
//
// Dois fluxos:
//  1) "/start CODIGO" — vincula o chat_id de quem mandou ao user_id dono
//     do código (gerado por telegram-gerar-codigo, válido 10 min).
//  2) callback_query "confirmar:<id>" / "ignorar:<id>" — mesma ação dos
//     botões da fila de revisão em Importar > Pluggy, só que a partir do
//     toque no botão do Telegram.
//
// Segredos usados: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";

const TELEGRAM_API = "https://api.telegram.org/bot";
const CODIGO_VALIDADE_MIN = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function tg(token: string, method: string, body: unknown) {
  try {
    const resp = await fetch(`${TELEGRAM_API}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) console.error(`Telegram ${method} falhou:`, resp.status, await resp.text());
  } catch (e) {
    console.error(`Erro chamando Telegram ${method}:`, e);
  }
}

/** Mesmo rótulo mostrado no formulário do app (js/menus-api.js:rotuloMetodo). */
function rotuloMetodo(m: { nome: string; metodo_kind: string | null; banco: string | null }): string {
  if (!m.metodo_kind || m.metodo_kind === "Dinheiro") return m.nome;
  return m.banco ? `${m.metodo_kind} ${m.banco}` : m.metodo_kind;
}

/** Mesma regra do app (js/recorrencia.js:competenciaDe). */
function competenciaDe(dataISO: string, diaFechamento: number | null): string {
  const [ano0, mes0, dia0] = dataISO.split("-").map(Number);
  let ano = ano0, mes = mes0 - 1; // 0-11
  if (diaFechamento && dia0 >= diaFechamento) {
    mes += 1;
    if (mes > 11) { mes = 0; ano += 1; }
  }
  return `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Método não suportado" }, 405);
  }

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!token || !webhookSecret) {
    console.error("TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET não configurados");
    return json({ ok: true }); // 200 pro Telegram não ficar reenviando
  }
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) {
    return json({ error: "Não autorizado" }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const update = await req.json();

    // ---------- Mensagem de texto (só tratamos "/start CODIGO" por ora) ----------
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const texto = String(update.message.text).trim();

      if (texto.startsWith("/start")) {
        const codigo = texto.split(/\s+/)[1]?.toUpperCase();
        if (!codigo) {
          await tg(token, "sendMessage", { chat_id: chatId, text: "Gere um código em Configurações > Importar > Pluggy no app e toque no link de novo." });
          return json({ ok: true });
        }

        const { data: linkRow } = await supabaseAdmin
          .from("telegram_link_codes")
          .select("user_id, criado_em")
          .eq("code", codigo)
          .maybeSingle();

        const expirado = !linkRow || (Date.now() - new Date(linkRow.criado_em).getTime()) > CODIGO_VALIDADE_MIN * 60 * 1000;
        if (!linkRow || expirado) {
          await tg(token, "sendMessage", { chat_id: chatId, text: "Código inválido ou expirado — gere um novo no app e toque no link de novo." });
          return json({ ok: true });
        }

        const { error: upsertError } = await supabaseAdmin
          .from("telegram_users")
          .upsert({ user_id: linkRow.user_id, chat_id: chatId }, { onConflict: "user_id" });
        if (upsertError) {
          console.error(upsertError);
          await tg(token, "sendMessage", { chat_id: chatId, text: "Deu erro ao vincular — tenta de novo em instantes." });
          return json({ ok: true });
        }
        await supabaseAdmin.from("telegram_link_codes").delete().eq("code", codigo);

        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: "✅ Conta vinculada! A partir de agora eu aviso por aqui quando um lançamento novo chegar via Pluggy.",
        });
        return json({ ok: true });
      }

      // Fase 1 (só notificação) — ainda não entende linguagem natural.
      await tg(token, "sendMessage", {
        chat_id: chatId,
        text: "Por enquanto eu só aviso sobre lançamentos novos e entendo os botões de Confirmar/Ignorar — perguntas em texto livre chegam numa próxima etapa.",
      });
      return json({ ok: true });
    }

    // ---------- Clique em botão inline (Confirmar/Ignorar) ----------
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const [acao, idStr] = String(cq.data || "").split(":");
      const importadaId = Number(idStr);

      if (!chatId || !importadaId || !["confirmar", "ignorar"].includes(acao)) {
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Ação inválida" });
        return json({ ok: true });
      }

      const { data: tgUser } = await supabaseAdmin.from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
      if (!tgUser) {
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Conta não vinculada" });
        return json({ ok: true });
      }

      const { data: item } = await supabaseAdmin
        .from("transacoes_importadas")
        .select("*")
        .eq("id", importadaId)
        .eq("user_id", tgUser.user_id) // nunca confia só no id vindo do botão
        .eq("status", "pendente")
        .maybeSingle();
      if (!item) {
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Já foi tratado antes" });
        return json({ ok: true });
      }

      if (acao === "ignorar") {
        await supabaseAdmin.from("transacoes_importadas").update({ status: "ignorada" }).eq("id", importadaId);
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Ignorado" });
        await tg(token, "editMessageText", {
          chat_id: chatId, message_id: cq.message.message_id,
          text: `${cq.message.text}\n\n❌ Ignorado`,
        });
        return json({ ok: true });
      }

      // Confirmar — precisa de categoria sugerida (sem isso, pede pra ir no app).
      if (!item.categoria_sugerida) {
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Sem categoria sugerida — confirme pelo app", show_alert: true });
        return json({ ok: true });
      }

      let metodoObj: { nome: string; metodo_kind: string | null; banco: string | null; dia_fechamento: number | null } | null = null;
      if (item.metodo_sugerido) {
        const { data: m } = await supabaseAdmin.from("menu_itens").select("nome, metodo_kind, banco, dia_fechamento").eq("id", item.metodo_sugerido).maybeSingle();
        metodoObj = m ?? null;
      }
      const competencia = competenciaDe(item.data, metodoObj?.metodo_kind === "Crédito" ? metodoObj.dia_fechamento : null);

      const { data: nova, error: insertError } = await supabaseAdmin
        .from("transacoes")
        .insert({
          tipo: item.tipo,
          data: item.data,
          valor: item.valor,
          metodo: metodoObj ? rotuloMetodo(metodoObj) : null,
          categoria: item.categoria_sugerida,
          descricao: item.descricao_banco || "",
          forma_pagamento: "À vista",
          tipo_recorrencia: "Pontual",
          competencia,
          status: "Ativa",
          origem: "pluggy",
          user_id: tgUser.user_id,
        })
        .select("id")
        .single();
      if (insertError) {
        console.error(insertError);
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Erro ao confirmar" });
        return json({ ok: true });
      }

      await supabaseAdmin.from("transacoes_importadas").update({ status: "confirmada", transacao_id: nova.id }).eq("id", importadaId);
      await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Confirmado ✅" });
      await tg(token, "editMessageText", {
        chat_id: chatId, message_id: cq.message.message_id,
        text: `${cq.message.text}\n\n✅ Confirmado`,
      });
      return json({ ok: true });
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: true }); // sempre 200 pro Telegram não reenviar em loop
  }
});

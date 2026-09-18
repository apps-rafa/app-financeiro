// Compartilhado entre pluggy-sync, pluggy-webhook e telegram-webhook.
//
// notificarTelegramNovas: manda uma mensagem por lançamento novo (fila de
// revisão) pro chat vinculado do usuário, com botões inline Confirmar/
// Ignorar — mesma ideia da fila de revisão da tela Pluggy, só que
// empurrada pro Telegram em vez de esperar o usuário abrir o app.
// Silenciosa se o usuário não vinculou o Telegram (telegram_users vazio)
// ou o secret TELEGRAM_BOT_TOKEN não está configurado.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface ItemNovoTelegram {
  id: number;
  tipo: "entradas" | "saidas";
  valor: number;
  data: string;
  descricao_banco: string | null;
  categoria_sugerida: string | null;
  metodo_sugerido: number | null;
}

/** Mesmo rótulo mostrado no formulário do app (js/menus-api.js:rotuloMetodo). */
function rotuloMetodo(m: { nome: string; metodo_kind: string | null; banco: string | null }): string {
  if (!m.metodo_kind || m.metodo_kind === "Dinheiro") return m.nome;
  return m.banco ? `${m.metodo_kind} ${m.banco}` : m.metodo_kind;
}

async function enviarMensagemTelegram(token: string, chatId: number, texto: string, botoes: unknown[][]) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: botoes },
      }),
    });
    if (!resp.ok) console.error("Telegram sendMessage falhou:", resp.status, await resp.text());
  } catch (e) {
    console.error("Erro ao chamar Telegram sendMessage:", e);
  }
}

// Só avisa transação com data de até 2 dias atrás — sem isso, qualquer
// sincronização que traga uma janela larga (ex.: primeira sync de uma
// conta nova, ou "Buscar últimos 30 dias") manda um aviso por lançamento
// do período inteiro de uma vez, virando spam de coisa que já aconteceu
// há semanas em vez de "acabou de cair".
const NOTIFICAR_ATE_DIAS_ATRAS = 2;

export async function notificarTelegramNovas(
  supabaseAdmin: SupabaseClient,
  userId: string,
  itens: ItemNovoTelegram[],
): Promise<void> {
  const dataLimite = new Date(Date.now() - NOTIFICAR_ATE_DIAS_ATRAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  itens = itens.filter((i) => i.data >= dataLimite);
  if (!itens.length) return;
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;

  const { data: tgUser } = await supabaseAdmin
    .from("telegram_users")
    .select("chat_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!tgUser) return; // usuário não vinculou o Telegram — nada a fazer

  const metodoIds = [...new Set(itens.map((i) => i.metodo_sugerido).filter((x): x is number => x != null))];
  const { data: metodos } = metodoIds.length
    ? await supabaseAdmin.from("menu_itens").select("id, nome, metodo_kind, banco").in("id", metodoIds)
    : { data: [] as { id: number; nome: string; metodo_kind: string | null; banco: string | null }[] };

  const nomeMetodo = (id: number | null) => {
    if (!id) return null;
    const m = (metodos ?? []).find((x: { id: number }) => x.id === id);
    return m ? rotuloMetodo(m) : null;
  };

  const fmtValor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  for (const item of itens) {
    const sinal = item.tipo === "entradas" ? "+" : "-";
    const emoji = item.tipo === "entradas" ? "💰" : "💸";
    const dataFmt = new Date(`${item.data}T00:00:00`).toLocaleDateString("pt-BR");
    const metodoTxt = nomeMetodo(item.metodo_sugerido);

    const texto = [
      `${emoji} *Novo lançamento via Pluggy*`,
      `${sinal} ${fmtValor.format(item.valor)} — ${dataFmt}`,
      item.descricao_banco ? `_${item.descricao_banco}_` : null,
      item.categoria_sugerida ? `Categoria sugerida: ${item.categoria_sugerida}` : "Sem sugestão de categoria — confirme pelo app",
      metodoTxt ? `Método: ${metodoTxt}` : null,
    ].filter(Boolean).join("\n");

    const botoes = item.categoria_sugerida
      ? [[{ text: "✅ Confirmar", callback_data: `confirmar:${item.id}` }, { text: "❌ Ignorar", callback_data: `ignorar:${item.id}` }]]
      : [[{ text: "❌ Ignorar", callback_data: `ignorar:${item.id}` }]];

    await enviarMensagemTelegram(token, tgUser.chat_id, texto, botoes);
  }
}

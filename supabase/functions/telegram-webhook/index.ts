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
const PLUGGY_API_URL = "https://api.pluggy.ai";

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

// ---------- Linguagem natural: "gastei 35,90 no mercado" vira um rascunho de
// lançamento (mesma ideia da fila de revisão — nada é gravado sem um toque
// em "✅ Confirmar"). Fase 2 prometida no comentário antigo aqui embaixo. ----------

// Mesma heurística por palavra-chave do pluggy-sync/pluggy-webhook, duplicada
// aqui só pra também sugerir categoria a partir do texto digitado no bot.
const PALAVRAS_CHAVE_CATEGORIA: { padrao: RegExp; categoria: string }[] = [
  { padrao: /drogaria|farm[aá]cia|droga ?raia|pacheco|pague ?menos|rem[eé]dio/, categoria: "Saúde" },
  { padrao: /hospital|cl[ií]nica|laborat[oó]rio|dentista|odont|m[eé]dico|consulta/, categoria: "Saúde" },
  { padrao: /academia|smart ?fit|bodytech|bio ?ritmo/, categoria: "Saúde" },
  { padrao: /supermercado|hortifruti|atacad[ãa]o|carrefour|extra|p[ãa]o de a[çc][uú]car|assa[íi]|mercado|feira/, categoria: "Mercado" },
  { padrao: /restaurante|lanchonete|padaria|pizzaria|churrascaria|almo[çc]o|janta|comida/, categoria: "Alimentação" },
  { padrao: /ifood|rappi|mcdonalds|burger king|habib|subway/, categoria: "Alimentação" },
  { padrao: /uber|99app|99pop|t[áa]xi|[oô]nibus|metr[oô]/, categoria: "Transporte" },
  { padrao: /posto|ipiranga|shell|petrobras|ale combust|gasolina/, categoria: "Transporte" },
  { padrao: /estacionamento|zona azul/, categoria: "Transporte" },
  { padrao: /netflix|spotify|disney|amazon prime|hbo|paramount|assinatura/, categoria: "Assinaturas" },
  { padrao: /cinema|cinemark|teatro|show|festa|balada/, categoria: "Lazer" },
  { padrao: /escola|faculdade|universidade|udemy|alura|curso/, categoria: "Educação" },
  { padrao: /condom[ií]nio|imobili[aá]ria|aluguel|luz|[aá]gua|g[aá]s\b|internet\b/, categoria: "Casa" },
  { padrao: /sal[aá]rio|sal[aá]rios/, categoria: "Salário" },
];

function sugerirCategoriaPorPalavraChave(texto: string): string | null {
  const alvo = texto.toLowerCase();
  const achado = PALAVRAS_CHAVE_CATEGORIA.find((p) => p.padrao.test(alvo));
  return achado ? achado.categoria : null;
}

/** Categoria pro rascunho: (1) nome de categoria do próprio usuário que
 *  apareça no texto; (2) palavra-chave; (3) "Outros"/1ª categoria do tipo,
 *  só pra nunca deixar o campo (obrigatório) vazio — o usuário troca depois
 *  se a sugestão não fizer sentido. */
function sugerirCategoriaTexto(
  texto: string,
  tipo: "entradas" | "saidas",
  categoriasApp: { nome: string; categoria_tipo: string | null }[],
): string {
  const candidatas = categoriasApp.filter((c) => c.categoria_tipo === tipo);
  const alvo = texto.toLowerCase();
  const porNome = candidatas.find((c) => alvo.includes(c.nome.toLowerCase()));
  if (porNome) return porNome.nome;

  const porPalavraChave = sugerirCategoriaPorPalavraChave(texto);
  if (porPalavraChave) {
    const achada = candidatas.find((c) => c.nome.toLowerCase() === porPalavraChave.toLowerCase());
    if (achada) return achada.nome;
  }

  const outros = candidatas.find((c) => c.nome.toLowerCase() === "outros");
  return outros?.nome || candidatas[0]?.nome || (tipo === "entradas" ? "Outros" : "Outros");
}

interface RascunhoLancamento {
  tipo: "entradas" | "saidas";
  valor: number;
  descricao: string;
  categoria: string;
  metodo: string | null;
  metodoKind: string | null;
  diaFechamento: number | null;
  data: string;
}

/** 'YYYY-MM-DD' de hoje em horário de Brasília (sem lib de timezone —
 *  Brasil não observa horário de verão desde 2019, então UTC-3 fixo). */
function hojeBrasiliaISO(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Interpreta uma mensagem de texto livre como um lançamento — "gastei
 *  35,90 no mercado", "recebi 200 de salário". Precisa achar um valor em
 *  dinheiro no texto; sem isso, não é um lançamento (retorna null e o bot
 *  cai no "não entendi"). */
function interpretarValorETipo(texto: string): { valor: number; tipo: "entradas" | "saidas"; resto: string } | null {
  const m = texto.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!m) return null;
  const valor = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  if (!isFinite(valor) || valor <= 0) return null;

  const ehReceita = /\b(recebi|ganhei|caiu|entrou|sal[aá]rio ca[ií]u)\b/i.test(texto);
  const tipo: "entradas" | "saidas" = ehReceita ? "entradas" : "saidas";
  const resto = (texto.slice(0, m.index) + texto.slice((m.index ?? 0) + m[0].length))
    .replace(/\b(r\$|reais?|conto|pila|de|no|na|em|com|paguei|gastei|comprei|recebi|ganhei)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { valor, tipo, resto };
}

interface ContaPluggy {
  id: number;
  item_id: string;
  account_id: string;
  marketing_name: string | null;
  tipo_conta: string | null;
  nome_conta: string | null;
  nome_instituicao: string | null;
  numero_mascarado: string | null;
  marca_cartao: string | null;
  metodo_id: number | null;
  /** Banco do "Método do app" ligado à conta (ex. "Bradesco") — é a fonte
   *  mais confiável: o conector "MeuPluggy" agrega vários bancos e não diz
   *  qual é o de cada conta. */
  banco_metodo?: string | null;
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "Nu Pagamentos S.A. - Instituição de Pagamento" -> "Nubank"; tira
 *  qualquer "(...)" final. */
function normalizarBanco(nome: string): string {
  if (/^nu pagamentos/i.test(nome.trim())) return "Nubank";
  return nome.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Nome da conta no formato "Banco: Tipo", ex.:
 *    Mercado Pago: Conta Pré-paga
 *    Bradesco: Cartão de crédito VISA INFINITE (final 1525)
 *    Nubank: Cartão de crédito MASTERCARD PLATINUM (final 8381)
 *  Cartão quebra em 2 linhas ("Nubank: Cartão de crédito" / "MASTERCARD
 *  PLATINUM (final 8381)") — é o que o menu do /atualizar mostra. O título
 *  curto do app vira "Cartão de crédito" genérico pra qualquer cartão. */
function linhasContaPluggy(c: ContaPluggy): string[] {
  const marketing = c.marketing_name ?? "";
  const tipoEntreParenteses = marketing.match(/\(([^)]+)\)\s*$/)?.[1] ?? null; // "Conta Pré-paga"
  const bancoBruto = c.banco_metodo
    || (marketing ? marketing.replace(/\s*\([^)]*\)\s*$/, "") : null)
    || (c.nome_instituicao && !/meupluggy/i.test(c.nome_instituicao) ? c.nome_instituicao : null);
  const banco = bancoBruto ? normalizarBanco(bancoBruto) : null;

  if (c.tipo_conta === "CREDIT") {
    const marca = (c.marca_cartao ?? "").toUpperCase();
    const nivel = (c.nome_conta ?? "").toUpperCase(); // "VISA INFINITE", "PLATINUM" ou o próprio banco
    let detalhe: string;
    if (nivel && marca && nivel.includes(marca)) detalhe = nivel;
    else if (nivel && banco && nivel === banco.toUpperCase()) detalhe = marca;
    else detalhe = [marca, nivel].filter(Boolean).join(" ");
    const linha1 = banco ? `${banco}: Cartão de crédito` : "Cartão de crédito";
    const linha2 = `${detalhe}${c.numero_mascarado ? `${detalhe ? " " : ""}(final ${c.numero_mascarado})` : ""}`;
    return linha2 ? [linha1, linha2] : [linha1];
  }

  const tipo = tipoEntreParenteses || c.nome_conta || "Conta bancária";
  return [banco ? `${banco}: ${tipo}` : tipo];
}

/** Mesmo nome numa linha só (log das transações, aviso de "Atualizando..."). */
function tituloContaPluggyDetalhado(c: ContaPluggy): string {
  return linhasContaPluggy(c).join(" ");
}

/** Contas Pluggy ativas do usuário, com o banco do "Método do app" junto
 *  (ver ContaPluggy.banco_metodo). Sem filtro de "sincronizar" de
 *  propósito — /atualizar é uma ação explícita do usuário no Telegram,
 *  independente do toggle "Incluir na sincronização" do botão automático
 *  do app. */
async function carregarContasPluggy(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ erro: unknown; contas: ContaPluggy[] }> {
  const { data, error } = await admin
    .from("pluggy_contas").select("*").eq("user_id", userId).in("status", ["ativo", "erro"]).order("id");
  if (error) return { erro: error, contas: [] };
  const contas = (data ?? []) as ContaPluggy[];
  const metodoIds = [...new Set(contas.map((c) => c.metodo_id).filter((id): id is number => !!id))];
  const bancos = new Map<number, string>();
  if (metodoIds.length) {
    const { data: metodos } = await admin.from("menu_itens").select("id, banco").in("id", metodoIds);
    for (const m of (metodos ?? []) as { id: number; banco: string | null }[]) if (m.banco) bancos.set(m.id, m.banco);
  }
  return {
    erro: null,
    contas: contas.map((c) => ({ ...c, banco_metodo: c.metodo_id ? bancos.get(c.metodo_id) ?? null : null })),
  };
}

function formatarMoedaBR(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "Rendimentos e dividendos" da Pluggy (juros de conta remunerada etc.) —
 *  sempre fora do /atualizar: são muitos, minúsculos, e não é isso que o
 *  usuário quer ver ao pedir as últimas transações. Mesma categoria que o
 *  toggle "Ignorar" do app usa (ver TRADUCAO_CATEGORIA_PLUGGY em
 *  pluggy-sync), só que aqui é sempre — sem toggle. */
function ehRendimentoPluggy(categoriaBruta: string | null | undefined): boolean {
  return (categoriaBruta || "").trim().toLowerCase() === "proceeds interests and dividends";
}

/** Força a Pluggy buscar dados novos AGORA nas contas passadas (PATCH
 *  /items/{id}, mesma chamada do "Sincronizar agora" no app) e manda de
 *  volta um log com as 3 transações mais recentes de cada uma. Usado pelo
 *  /atualizar tanto pra "Todas as contas" quanto pra uma conta escolhida
 *  no teclado. */
async function executarAtualizacaoPluggy(
  token: string,
  chatId: number,
  contas: ContaPluggy[],
): Promise<void> {
  try {
    const apiKey = await getPluggyApiKey();

    // Assíncrono do lado da Pluggy, por isso a pequena espera antes de
    // buscar as transações; itemIds repetidos (várias contas da mesma
    // conexão) só disparam uma vez.
    const itemIds = [...new Set(contas.map((c) => c.item_id))];
    await Promise.all(itemIds.map((itemId) =>
      fetch(`${PLUGGY_API_URL}/items/${itemId}`, {
        method: "PATCH",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch((e) => console.error(`Falha ao forçar atualização do item ${itemId}:`, e))
    ));
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // /v2/transactions não aceita "pageSize" (só filtros — accountId,
    // dateFrom/dateTo — e pagina por cursor via "next" na resposta, igual
    // ao pluggy-sync); busca uma janela recente e pega as 3 mais novas no
    // client.
    const dateFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const blocos: string[] = [];
    for (const conta of contas) {
      const titulo = escaparHtml(tituloContaPluggyDetalhado(conta));
      try {
        const resp = await pluggyGet(`/v2/transactions?accountId=${conta.account_id}&dateFrom=${dateFrom}`, apiKey);
        const ultimas = [...(resp.results ?? [])]
          .filter((t: { category?: string }) => !ehRendimentoPluggy(t.category))
          .sort((a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : -1))
          .slice(0, 3);
        if (!ultimas.length) {
          blocos.push(`🏦 <b>${titulo}</b>\nSem transações no período.`);
          continue;
        }
        const linhas = ultimas.map((t: { date: string; amount: number; type: string; description?: string; descriptionRaw?: string }) => {
          const data = String(t.date).slice(0, 10).split("-").reverse().join("/");
          const sinal = t.type === "CREDIT" ? "+" : "-";
          const desc = t.description || t.descriptionRaw || "(sem descrição)";
          return `• ${data} ${sinal}${formatarMoedaBR(Math.abs(Number(t.amount) || 0))} — ${desc}`;
        });
        blocos.push(`🏦 <b>${titulo}</b>\n${linhas.join("\n")}`);
      } catch (e) {
        console.error(`Erro buscando transações da conta ${conta.id}:`, e);
        blocos.push(`🏦 <b>${titulo}</b>\n⚠️ Erro ao buscar transações.`);
      }
    }

    await tg(token, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `✅ Atualizado. Últimas transações por conta:\n\n${blocos.join("\n\n")}`,
    });
  } catch (e) {
    console.error("Erro no /atualizar:", e);
    await tg(token, "sendMessage", { chat_id: chatId, text: "Deu erro ao atualizar com a Pluggy — tenta de novo em instantes." });
  }
}

/** Mesmo par client_id/client_secret do pluggy-sync — gera uma API key
 *  válida por ~2h da Pluggy. */
async function getPluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get("PLUGGY_CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configurados");
  }
  const resp = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!resp.ok) throw new Error(`Pluggy /auth falhou (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.apiKey as string;
}

async function pluggyGet(path: string, apiKey: string) {
  const resp = await fetch(`${PLUGGY_API_URL}${path}`, { headers: { "X-API-KEY": apiKey } });
  if (!resp.ok) throw new Error(`Pluggy ${path} falhou (${resp.status}): ${await resp.text()}`);
  return resp.json();
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

/** Grava de vez um rascunho (ver RascunhoLancamento) como lançamento de
 *  verdade em `transacoes` — chamado tanto pelo teclado (texto exato
 *  "✅ Confirmar") quanto pelo botão inline antigo (callback "nlconfirmar",
 *  mantido por compatibilidade). */
async function confirmarRascunhoNoBanco(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  d: RascunhoLancamento,
): Promise<{ erro: unknown }> {
  const ehCredito = d.metodoKind === "Crédito";
  const competencia = competenciaDe(d.data, ehCredito ? d.diaFechamento : null);
  const { error } = await supabaseAdmin.from("transacoes").insert({
    tipo: d.tipo,
    data: d.data,
    valor: d.valor,
    metodo: d.tipo === "saidas" ? d.metodo : null,
    categoria: d.categoria,
    descricao: d.descricao,
    forma_pagamento: "À vista",
    tipo_recorrencia: "Pontual",
    competencia,
    status: "Ativa",
    user_id: userId,
  });
  return { erro: error };
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

  // deno-lint-ignore no-explicit-any
  let update: any;
  try {
    update = await req.json();

    // ---------- Mensagem de texto (só tratamos "/start CODIGO" por ora) ----------
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const texto = String(update.message.text).trim();

      if (texto.startsWith("/start")) {
        // Já vinculado antes (ex.: clicou o link de novo, ou mandou o mesmo
        // código 2x — o código é apagado assim que usado com sucesso, então
        // a 2ª tentativa achava "código inválido ou expirado" mesmo tendo
        // acabado de funcionar segundos antes, o que é confuso).
        const { data: jaVinculado } = await supabaseAdmin
          .from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
        if (jaVinculado) {
          await tg(token, "sendMessage", { chat_id: chatId, text: "✅ Você já está vinculado — não precisa fazer de novo." });
          return json({ ok: true });
        }

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
          text: "✅ Conta vinculada! A partir de agora eu aviso por aqui quando um lançamento novo chegar via Pluggy. Mande /atualizar a qualquer hora pra forçar buscar dados novos nas suas contas.",
        });
        return json({ ok: true });
      }

      // "/atualizar" — pergunta qual conexão bancária atualizar (teclado
      // inline) antes de ir na Pluggy; a atualização em si (PATCH /items/
      // {id}, igual ao "Sincronizar agora" do app + log das 3 transações
      // mais recentes) só acontece depois do toque num botão (ver
      // callback_query "atualizarconta:" mais abaixo). Não mexe na fila de
      // revisão do app (isso continua exigindo o "Sincronizar" no app ou o
      // aviso automático do pluggy-webhook).
      if (texto.startsWith("/atualizar")) {
        const { data: tgUser } = await supabaseAdmin
          .from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
        if (!tgUser) {
          await tg(token, "sendMessage", { chat_id: chatId, text: "Conta não vinculada — mande /start com o código do app primeiro." });
          return json({ ok: true });
        }

        const { erro: contasError, contas } = await carregarContasPluggy(supabaseAdmin, tgUser.user_id);
        if (contasError) {
          console.error(contasError);
          await tg(token, "sendMessage", { chat_id: chatId, text: "Deu erro ao buscar suas contas conectadas." });
          return json({ ok: true });
        }
        if (!contas.length) {
          await tg(token, "sendMessage", { chat_id: chatId, text: "Nenhuma conta conectada pra atualizar (Configurações > Open Finance no app)." });
          return json({ ok: true });
        }

        // Só 1 conta conectada: não faz sentido perguntar, vai direto.
        if (contas.length === 1) {
          await tg(token, "sendMessage", { chat_id: chatId, text: "🔄 Atualizando..." });
          await executarAtualizacaoPluggy(token, chatId, contas);
          return json({ ok: true });
        }

        // Todo menu do bot termina com "Cancelar" (callback "cancelar",
        // tratado mais abaixo — vale pra qualquer teclado novo também).
        // O texto de um botão inline é sempre centralizado e numa linha só
        // (o Telegram não deixa mudar) — por isso as contas vão listadas no
        // TEXTO da mensagem (alinhado à esquerda, com quebra de linha) e os
        // botões são só os números.
        const lista = contas
          .map((c, i) => {
            const [linha1, ...resto] = linhasContaPluggy(c).map(escaparHtml);
            return [`<b>${i + 1}.</b> ${linha1}`, ...resto].join("\n");
          })
          .join("\n\n");
        const numeros = contas.map((c, i) => ({ text: String(i + 1), callback_data: `atualizarconta:${c.id}` }));
        const botoes: { text: string; callback_data: string }[][] = [];
        for (let i = 0; i < numeros.length; i += 5) botoes.push(numeros.slice(i, i + 5));
        botoes.push([{ text: "🔄 Todas as contas", callback_data: "atualizarconta:todas" }]);
        botoes.push([{ text: "❌ Cancelar", callback_data: "cancelar" }]);
        await tg(token, "sendMessage", {
          chat_id: chatId,
          parse_mode: "HTML",
          text: `Qual conta você quer atualizar?\n\n${lista}`,
          reply_markup: { inline_keyboard: botoes },
        });
        return json({ ok: true });
      }

      // Resposta pelo TECLADO (não um botão dentro da mensagem) do rascunho
      // de lançamento — texto exato de um dos 2 botões mandados junto do
      // rascunho, ver mais abaixo. Só existe 1 rascunho pendente por chat
      // de cada vez (um texto novo substitui o anterior), então não precisa
      // de id — o mais recente do chat já resolve. "Cancelar" sempre junto
      // do "Confirmar", nunca só um dos dois.
      if (texto === "✅ Confirmar" || texto === "❌ Cancelar") {
        const { data: tgUser } = await supabaseAdmin.from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
        const { data: rascunho } = tgUser
          ? await supabaseAdmin.from("telegram_rascunhos").select("id, dados")
              .eq("chat_id", chatId).eq("user_id", tgUser.user_id)
              .order("criado_em", { ascending: false }).limit(1).maybeSingle()
          : { data: null };
        if (!rascunho) {
          await tg(token, "sendMessage", {
            chat_id: chatId, text: "Não tem nenhum rascunho esperando confirmação.",
            reply_markup: { remove_keyboard: true },
          });
          return json({ ok: true });
        }
        await supabaseAdmin.from("telegram_rascunhos").delete().eq("id", rascunho.id);
        if (texto === "❌ Cancelar") {
          await tg(token, "sendMessage", { chat_id: chatId, text: "❌ Cancelado.", reply_markup: { remove_keyboard: true } });
          return json({ ok: true });
        }
        const { erro } = await confirmarRascunhoNoBanco(supabaseAdmin, tgUser!.user_id, rascunho.dados as RascunhoLancamento);
        if (erro) {
          console.error(erro);
          await tg(token, "sendMessage", { chat_id: chatId, text: "Erro ao confirmar — tenta de novo.", reply_markup: { remove_keyboard: true } });
          return json({ ok: true });
        }
        await tg(token, "sendMessage", { chat_id: chatId, text: "✅ Lançado!", reply_markup: { remove_keyboard: true } });
        return json({ ok: true });
      }

      // Texto livre: tenta entender como um lançamento ("gastei 35,90 no
      // mercado", "recebi 200 de salário"). Sem um valor em dinheiro no
      // texto, não dá pra saber o que é — cai no "não entendi" de sempre.
      const achado = interpretarValorETipo(texto);
      if (!achado) {
        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: "Não entendi. Pra lançar por aqui, manda algo tipo \"gastei 35,90 no mercado\" ou \"recebi 200 de salário\" — eu monto um rascunho e só grava depois de você confirmar no teclado. Também entendo os botões de Confirmar/Ignorar (quando chegam da Pluggy) e o comando /atualizar.",
        });
        return json({ ok: true });
      }

      const { data: tgUser } = await supabaseAdmin.from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
      if (!tgUser) {
        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: "Pra lançar por aqui eu preciso que você vincule sua conta primeiro — gere o código em Configurações > Open Finance no app e toque no link.",
        });
        return json({ ok: true });
      }

      const [{ data: categoriasApp }, { data: metodosApp }] = await Promise.all([
        supabaseAdmin.from("menu_itens").select("nome, categoria_tipo").eq("tipo", "Categoria").eq("status", "Ativo").eq("user_id", tgUser.user_id),
        supabaseAdmin.from("menu_itens").select("nome, metodo_kind, banco, dia_fechamento").eq("tipo", "Método").eq("status", "Ativo").eq("user_id", tgUser.user_id).order("ordem"),
      ]);

      const { valor, tipo, resto } = achado;
      const descricao = resto ? resto.charAt(0).toUpperCase() + resto.slice(1) : (tipo === "entradas" ? "Recebido" : "Gasto");
      const categoria = sugerirCategoriaTexto(texto, tipo, categoriasApp ?? []);

      // Forma de pgto.: só faz sentido perguntar/usar em despesa — receita
      // não pede método no formulário do app (só Estorno/Reembolso, caso
      // raro demais pra tentar adivinhar por texto livre). Tenta achar o
      // nome/banco de um método do usuário mencionado no texto; senão
      // Crédito, depois Pix, depois Dinheiro (o caso comum de "20 no
      // mercado" sem dizer a forma é ter pago no cartão — Dinheiro só
      // entra por último, e só se estiver ativo pro usuário).
      let metodoObj: { nome: string; metodo_kind: string | null; banco: string | null; dia_fechamento: number | null } | null = null;
      if (tipo === "saidas") {
        const alvo = texto.toLowerCase();
        const lista = (metodosApp ?? []) as { nome: string; metodo_kind: string | null; banco: string | null; dia_fechamento: number | null }[];
        metodoObj = lista.find((m) => alvo.includes(m.nome.toLowerCase()) || (m.banco && alvo.includes(m.banco.toLowerCase())))
          || lista.find((m) => m.metodo_kind === "Crédito")
          || lista.find((m) => m.metodo_kind === "PIX")
          || lista.find((m) => m.metodo_kind === "Dinheiro")
          || lista[0]
          || null;
      }

      const rascunho: RascunhoLancamento = {
        tipo, valor, descricao, categoria,
        metodo: metodoObj ? rotuloMetodo(metodoObj) : null,
        metodoKind: metodoObj?.metodo_kind ?? null,
        diaFechamento: metodoObj?.dia_fechamento ?? null,
        data: hojeBrasiliaISO(),
      };

      // Só 1 rascunho pendente por vez por chat — um novo texto substitui o anterior.
      await supabaseAdmin.from("telegram_rascunhos").delete().eq("chat_id", chatId);
      const { data: novoRascunho, error: erroRascunho } = await supabaseAdmin
        .from("telegram_rascunhos")
        .insert({ user_id: tgUser.user_id, chat_id: chatId, dados: rascunho })
        .select("id").single();
      if (erroRascunho || !novoRascunho) {
        console.error(erroRascunho);
        await tg(token, "sendMessage", { chat_id: chatId, text: "Deu erro ao montar o rascunho — tenta de novo." });
        return json({ ok: true });
      }

      const sinal = tipo === "entradas" ? "💰 Receita" : "💸 Despesa";
      const dataFmt = new Date(`${rascunho.data}T00:00:00`).toLocaleDateString("pt-BR");
      const linhas = [
        `${sinal} — ${formatarMoedaBR(valor)}`,
        `${dataFmt} · ${categoria}`,
        descricao,
        tipo === "saidas" ? `Forma de pgto.: ${rascunho.metodo || "nenhuma cadastrada — ajuste no app"}` : null,
        "",
        "Confirma?",
      ].filter((l) => l !== null).join("\n");
      // Teclado (embaixo, onde se digita) em vez de botão dentro da
      // mensagem — as opções ficam no MESMO lugar de sempre, junto do
      // teclado numérico, em vez de ter que rolar até a mensagem certa pra
      // tocar. "one_time_keyboard" some sozinho depois de usado.
      await tg(token, "sendMessage", {
        chat_id: chatId,
        text: linhas,
        reply_markup: {
          keyboard: [[{ text: "✅ Confirmar" }, { text: "❌ Cancelar" }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return json({ ok: true });
    }

    // ---------- Clique em botão inline (Confirmar/Ignorar/Atualizar conta) ----------
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const [acao, idStr] = String(cq.data || "").split(":");

      // "Cancelar" — presente em todo menu do bot: tira o teclado e marca a
      // mensagem como cancelada (editMessageText sem reply_markup remove os
      // botões).
      if (acao === "cancelar" && chatId) {
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Cancelado" });
        await tg(token, "editMessageText", {
          chat_id: chatId, message_id: cq.message.message_id,
          text: `${cq.message.text}\n\n❌ Cancelado`,
        });
        return json({ ok: true });
      }

      // Rascunho de lançamento por texto livre (ver interpretarValorETipo
      // acima) — "❌ Cancelar" só apaga o rascunho; "✅ Confirmar" grava de
      // verdade em transacoes.
      if ((acao === "nlconfirmar" || acao === "nlcancelar") && chatId) {
        const rascunhoId = Number(idStr);
        const { data: tgUser } = await supabaseAdmin.from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
        if (!tgUser) {
          await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Conta não vinculada" });
          return json({ ok: true });
        }
        const { data: rascunho } = await supabaseAdmin
          .from("telegram_rascunhos").select("dados")
          .eq("id", rascunhoId).eq("chat_id", chatId).eq("user_id", tgUser.user_id) // nunca confia só no id vindo do botão
          .maybeSingle();
        if (!rascunho) {
          await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Esse rascunho já não existe mais" });
          return json({ ok: true });
        }

        if (acao === "nlcancelar") {
          await supabaseAdmin.from("telegram_rascunhos").delete().eq("id", rascunhoId);
          await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Cancelado" });
          await tg(token, "editMessageText", {
            chat_id: chatId, message_id: cq.message.message_id,
            text: `${cq.message.text}\n\n❌ Cancelado`,
          });
          return json({ ok: true });
        }

        const { erro: insertError } = await confirmarRascunhoNoBanco(supabaseAdmin, tgUser.user_id, rascunho.dados as RascunhoLancamento);
        await supabaseAdmin.from("telegram_rascunhos").delete().eq("id", rascunhoId);
        if (insertError) {
          console.error(insertError);
          await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Erro ao confirmar" });
          return json({ ok: true });
        }
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Lançado ✅" });
        await tg(token, "editMessageText", {
          chat_id: chatId, message_id: cq.message.message_id,
          text: `${cq.message.text}\n\n✅ Lançado`,
        });
        return json({ ok: true });
      }

      // Escolha de conta no teclado do /atualizar — "todas" ou o id de uma
      // pluggy_contas específica.
      if (acao === "atualizarconta" && chatId) {
        const { data: tgUser } = await supabaseAdmin.from("telegram_users").select("user_id").eq("chat_id", chatId).maybeSingle();
        if (!tgUser) {
          await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Conta não vinculada" });
          return json({ ok: true });
        }
        const { contas } = await carregarContasPluggy(supabaseAdmin, tgUser.user_id);
        const contaId = idStr === "todas" ? null : Number(idStr);
        // Nunca confia só no id vindo do botão — filtra pelas contas do
        // PRÓPRIO usuário vinculado, não pelo id cru.
        const alvo = contaId ? contas.filter((c) => c.id === contaId) : contas;
        if (!alvo.length) {
          await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Conta não encontrada" });
          return json({ ok: true });
        }
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Atualizando..." });
        await tg(token, "editMessageText", {
          chat_id: chatId, message_id: cq.message.message_id,
          text: `🔄 Atualizando ${contaId ? tituloContaPluggyDetalhado(alvo[0]) : `${alvo.length} conta(s)`}...`,
        });
        await executarAtualizacaoPluggy(token, chatId, alvo);
        return json({ ok: true });
      }

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
          dados_originais: {
            pluggy_transaction_id: item.pluggy_transaction_id,
            data: item.data,
            valor: item.valor,
            tipo: item.tipo,
            descricao_banco: item.descricao_banco,
            categoria_pluggy: item.categoria_pluggy,
            categoria_sugerida: item.categoria_sugerida,
          },
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
    // Qualquer erro inesperado aqui em cima retornava 200 pro Telegram sem
    // nunca avisar o usuário — a mensagem simplesmente "não respondia",
    // sem pista de que algo deu errado. Tenta mandar um aviso genérico pro
    // mesmo chat (melhor esforço — se isso também falhar, azar, mas pelo
    // menos tentou).
    try {
      const chatId = update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
      if (chatId) await tg(token, "sendMessage", { chat_id: chatId, text: "Deu um erro aqui do meu lado — tenta de novo em instantes." });
    } catch (_) { /* melhor esforço mesmo */ }
    return json({ ok: true }); // sempre 200 pro Telegram não reenviar em loop
  }
});

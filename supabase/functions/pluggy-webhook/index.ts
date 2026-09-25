// Edge Function: pluggy-webhook
//
// Chamada pela própria Pluggy (não pelo client) quando há novidade num
// item conectado (item/updated, transactions/created, ...). Sem
// verify_jwt — a Pluggy não manda um JWT nosso — protegida por um
// segredo próprio na query string (?wh=...) e NUNCA confia no corpo do
// payload: usa só o itemId como gatilho pra rebuscar os dados de
// verdade na API da Pluggy, com nossas credenciais.
//
// Roda com a service role key (não há sessão de usuário num webhook) —
// por isso resolve o usuário só a partir do itemId (que só existe em
// pluggy_contas de usuários reais), nunca de nada vindo do payload.
//
// Segredos usados: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET.
// Ver plano da integração: memória "app-financeiro-pluggy-integracao".

import { createClient } from "npm:@supabase/supabase-js@2";
import { notificarTelegramNovas } from "../_shared/telegram.ts";

const PLUGGY_API_URL = "https://api.pluggy.ai";
const DIAS_HISTORICO_PRIMEIRA_SYNC = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Movimentos que só trocam o dinheiro de lugar (resgate/aplicação, saldo
 *  reservado, pagamento da fatura do cartão) — não são receita nem despesa de
 *  verdade. Entram na fila já como "ignorada" (visível em "Já ignoradas",
 *  com ↺ pra reativar), sem avisar no Telegram. */
function ehMovimentoInterno(operationType: string | null | undefined): boolean {
  const op = String(operationType ?? "").toUpperCase();
  return op === "RESGATE_APLIC_FINANCEIRA" || op.startsWith("APLIC")
    || op === "TRANSFERENCIA_SALDO_RESERVADO" || op === "PAGAMENTO_FATURA";
}

/** Guarda as faturas do banco (pluggy_faturas) de um cartão — usadas no app pra
 *  conferir o total lançado com o total da fatura. Não derruba o sync. */
async function guardarFaturasBanco(
  // deno-lint-ignore no-explicit-any
  cliente: any, userId: string, contaId: number, accountId: string, apiKey: string,
): Promise<void> {
  try {
    const bills = await pluggyGet(`/bills?accountId=${accountId}`, apiKey);
    const faturas = (bills.results ?? []).filter((b: { id?: string }) => b?.id).map((b: Record<string, unknown>) => ({
      user_id: userId, conta_id: contaId, bill_id: b.id,
      vencimento: b.dueDate ? String(b.dueDate).slice(0, 10) : null,
      fechamento: b.billClosingDate ? String(b.billClosingDate).slice(0, 10) : null,
      total: typeof b.totalAmount === "number" ? b.totalAmount : null,
      minimo: typeof b.minimumPaymentAmount === "number" ? b.minimumPaymentAmount : null,
      atualizado_em: new Date().toISOString(),
    }));
    if (faturas.length) await cliente.from("pluggy_faturas").upsert(faturas, { onConflict: "user_id,bill_id" });
  } catch (e) {
    console.error(`Faturas indisponíveis (conta ${contaId}):`, e);
  }
}

/** Mesmo rótulo do formulário do app (js/menus-api.js:rotuloMetodo). */
function rotuloMetodo(m: { nome: string; metodo_kind: string | null; banco: string | null }): string {
  if (!m.metodo_kind || m.metodo_kind === "Dinheiro") return m.nome;
  return m.banco ? `${m.metodo_kind} ${m.banco}` : m.metodo_kind;
}

/** Concilia, ANTES de avisar no Telegram, as transações novas do banco com
 *  lançamentos que o usuário já fez (à mão ou pelo bot): mesmo tipo e valor,
 *  data a até 2 dias e, quando os dois lados têm forma de pgto., a mesma. Um
 *  pra um (o mesmo lançamento nunca concilia 2 transações do banco). A linha
 *  do banco vira 'confirmada' ligada a ele — mesma conciliação que o app faz na
 *  revisão (js/pluggy.js:_marcarDuplicatasPluggy). Devolve os ids conciliados
 *  (não devem gerar aviso). Falhar aqui só significa avisar como antes. */
async function conciliarComExistentes(
  // deno-lint-ignore no-explicit-any
  cliente: any,
  userId: string,
  itens: { id: number; tipo: string; valor: number; data: string; metodo_sugerido: number | null }[],
): Promise<Set<number>> {
  const conciliados = new Set<number>();
  if (!itens.length) return conciliados;
  try {
    const dia = (iso: string) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
    const diffDias = (a: string, b: string) => Math.abs(dia(a) - dia(b)) / 86400000;
    const somaDias = (iso: string, d: number) => new Date(dia(iso) + d * 86400000).toISOString().slice(0, 10);
    const datas = itens.map((i) => String(i.data).slice(0, 10)).sort();

    const { data: existentes } = await cliente.from("transacoes")
      .select("id, tipo, valor, data, metodo, origem")
      .eq("user_id", userId)
      .gte("data", somaDias(datas[0], -2)).lte("data", somaDias(datas[datas.length - 1], 2));
    const candidatos = (existentes ?? []).filter((t: { origem: string | null }) => t.origem !== "pluggy");
    if (!candidatos.length) return conciliados;

    const { data: ligados } = await cliente.from("transacoes_importadas")
      .select("transacao_id").eq("user_id", userId)
      .in("transacao_id", candidatos.map((c: { id: number }) => c.id));
    const jaLigados = new Set((ligados ?? []).map((l: { transacao_id: number }) => l.transacao_id));

    const metodoIds = [...new Set(itens.map((i) => i.metodo_sugerido).filter((x): x is number => x != null))];
    const rotulos = new Map<number, string>();
    if (metodoIds.length) {
      const { data: ms } = await cliente.from("menu_itens").select("id, nome, metodo_kind, banco").in("id", metodoIds);
      for (const m of ms ?? []) rotulos.set(m.id, rotuloMetodo(m));
    }

    const usados = new Set<number>();
    const ordenados = [...itens].sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id);
    for (const item of ordenados) {
      const rot = item.metodo_sugerido != null ? rotulos.get(item.metodo_sugerido) ?? null : null;
      const cands = candidatos
        .filter((t: { id: number; tipo: string; valor: string | number; data: string; metodo: string | null }) =>
          !usados.has(t.id) && !jaLigados.has(t.id) && t.tipo === item.tipo &&
          Math.abs(Math.abs(Number(t.valor)) - Math.abs(Number(item.valor))) < 0.005 &&
          diffDias(t.data, item.data) <= 2 && (!rot || !t.metodo || t.metodo === rot))
        .sort((a: { data: string; metodo: string | null }, b: { data: string; metodo: string | null }) =>
          ((rot && b.metodo === rot) ? 1 : 0) - ((rot && a.metodo === rot) ? 1 : 0) ||
          diffDias(a.data, item.data) - diffDias(b.data, item.data));
      if (!cands.length) continue;
      const { error } = await cliente.from("transacoes_importadas")
        .update({ status: "confirmada", transacao_id: cands[0].id }).eq("id", item.id);
      if (error) { console.error("Conciliação:", error); continue; }
      usados.add(cands[0].id);
      conciliados.add(item.id);
    }
  } catch (e) {
    console.error("Conciliação automática indisponível:", e);
  }
  return conciliados;
}

async function getPluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get("PLUGGY_CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configurados nos secrets da função");
  }
  const resp = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!resp.ok) {
    throw new Error(`Pluggy /auth falhou (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.apiKey as string;
}

async function pluggyGet(path: string, apiKey: string) {
  const resp = await fetch(`${PLUGGY_API_URL}${path}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!resp.ok) {
    throw new Error(`Pluggy ${path} falhou (${resp.status}): ${await resp.text()}`);
  }
  return resp.json();
}

// Mesma taxonomia/dicionário de js pluggy-sync (docs.pluggy.ai/docs/transaction-categories).
// Duplicado aqui de propósito — as duas funções são deployadas de forma
// independente; ver nota na memória do projeto sobre extrair um módulo
// compartilhado se isso crescer mais.
const TRADUCAO_CATEGORIA_PLUGGY: Record<string, string> = {
  "income": "Receita", "loans and financing": "Empréstimos e financiamento",
  "investments": "Investimentos", "same person transfer": "Transferência entre contas próprias",
  "transfers": "Transferências", "legal obligations": "Obrigações legais",
  "services": "Serviços", "shopping": "Compras", "digital services": "Serviços digitais",
  "groceries": "Mercado", "food and drinks": "Alimentação", "travel": "Viagem",
  "donations": "Doações", "gambling": "Jogos de azar", "taxes": "Impostos",
  "bank fees": "Tarifas bancárias", "housing": "Casa", "healthcare": "Saúde",
  "transportation": "Transporte", "insurance": "Seguro", "leisure": "Lazer", "other": "Outro",
  "salary": "Salário", "retirement": "Aposentadoria",
  "entrepreneurial activities": "Atividade autônoma", "government aid": "Auxílio governamental",
  "non-recurring income": "Receita eventual",
  "late payment and overdraft costs": "Juros por atraso", "interests charged": "Juros cobrados",
  "loans": "Empréstimo", "financing": "Financiamento",
  "automatic investment": "Investimento automático", "fixed income": "Renda fixa",
  "mutual funds": "Fundos de investimento", "variable income": "Renda variável",
  "margin": "Margem", "proceeds interests and dividends": "Rendimentos e dividendos",
  "pension": "Previdência",
  "same person transfer - cash": "Transferência própria em dinheiro",
  "same person transfer - pix": "Transferência própria via PIX",
  "same person transfer - ted": "Transferência própria via TED",
  "transfer - bank slip (boleto)": "Pagamento de boleto", "transfer - cash": "Transferência em dinheiro",
  "transfer - check": "Transferência por cheque", "transfer - doc": "Transferência DOC",
  "transfer - foreign exchange": "Câmbio", "transfer - internal": "Transferência interna",
  "transfer - pix": "PIX", "transfer - ted": "TED",
  "credit card payment": "Pagamento de fatura do cartão", "third-party transfers": "Transferência a terceiros",
  "blocked balances": "Saldo bloqueado", "alimony": "Pensão alimentícia",
  "telecommunications": "Telecomunicações", "education": "Educação",
  "wellness and fitness": "Bem-estar e academia", "tickets": "Ingressos",
  "online shopping": "Compras online", "electronics": "Eletrônicos",
  "pet supplies and vet": "Pet shop e veterinário", "clothing": "Roupas",
  "kids and toys": "Infantil e brinquedos", "bookstore": "Livraria",
  "sports goods": "Artigos esportivos", "office supplies": "Material de escritório",
  "cashback": "Cashback",
  "gaming": "Jogos", "video streaming": "Streaming de vídeo", "music streaming": "Streaming de música",
  "eating out": "Restaurante", "food delivery": "Delivery de comida",
  "airport and airlines": "Aeroporto e companhias aéreas", "accommodation": "Hospedagem",
  "mileage programs": "Programa de milhas", "bus tickets": "Passagem de ônibus",
  "lottery": "Loteria", "online bet": "Aposta online",
  "income taxes": "Imposto de renda", "taxes on investments": "Imposto sobre investimentos",
  "tax on financial operations": "IOF",
  "account fees": "Tarifa de conta", "wire transfer fees and atm fees": "Tarifa de TED/saque",
  "credit card fees": "Tarifa de cartão de crédito",
  "rent": "Aluguel", "houseware": "Utilidades domésticas",
  "urban land and building tax": "IPTU", "utilities": "Contas de casa",
  "dentist": "Dentista", "pharmacy": "Farmácia", "optometry": "Oftalmologia",
  "hospital clinics and labs": "Hospital e laboratório",
  "taxi and ride-hailing": "Transporte por app", "public transportation": "Transporte público",
  "car rental": "Aluguel de carro", "bicycle": "Bicicleta", "automotive": "Automotivo",
  "life insurance": "Seguro de vida", "home insurance": "Seguro residencial",
  "health insurance": "Seguro saúde", "vehicle insurance": "Seguro veicular",
  "real estate financing": "Financiamento imobiliário", "vehicle financing": "Financiamento de veículo",
  "student loan": "Financiamento estudantil",
  "internet": "Internet", "mobile": "Celular", "tv": "TV",
  "online courses": "Cursos online", "university": "Faculdade", "school": "Escola",
  "kindergarten": "Creche",
  "gyms and fitness centers": "Academia", "sports practice": "Prática esportiva",
  "wellness": "Bem-estar",
  "stadiums and arenas": "Estádios e arenas", "landmarks and museums": "Pontos turísticos e museus",
  "cinema, theater and concerts": "Cinema, teatro e shows",
  "bank slip": "Boleto", "debt card": "Cartão de débito", "doc": "DOC",
  "water": "Água", "electricity": "Energia elétrica", "gas": "Gás",
  "gas stations": "Posto de gasolina", "parking": "Estacionamento",
  "tolls and in-vehicle payment": "Pedágio",
  "vehicle ownership taxes and fees": "IPVA e taxas", "vehicle maintenance": "Manutenção veicular",
  "traffic tickets": "Multas de trânsito",
};

function traduzirCategoriaPluggy(categoriaPluggy: string): string {
  return TRADUCAO_CATEGORIA_PLUGGY[categoriaPluggy.trim().toLowerCase()] ?? categoriaPluggy;
}

// Ver nota equivalente em pluggy-sync: heurística por nome do
// estabelecimento pra quando o nome bate com algo reconhecível mesmo sem a
// categoria da Pluggy ajudar (ex.: "DROGARIAS IMPERIAL LTDA" → Saúde).
const PALAVRAS_CHAVE_CATEGORIA: { padrao: RegExp; categoria: string }[] = [
  { padrao: /drogaria|farm[aá]cia|droga ?raia|pacheco|pague ?menos/, categoria: "Saúde" },
  { padrao: /hospital|cl[ií]nica|laborat[oó]rio|dentista|odont/, categoria: "Saúde" },
  { padrao: /academia|smart ?fit|bodytech|bio ?ritmo/, categoria: "Saúde" },
  { padrao: /supermercado|hortifruti|atacad[ãa]o|carrefour|extra|p[ãa]o de a[çc][uú]car|assa[íi]/, categoria: "Mercado" },
  { padrao: /restaurante|lanchonete|padaria|pizzaria|churrascaria/, categoria: "Alimentação" },
  { padrao: /ifood|rappi|mcdonalds|burger king|habib|subway/, categoria: "Alimentação" },
  { padrao: /uber|99app|99pop|t[áa]xi/, categoria: "Transporte" },
  { padrao: /posto|ipiranga|shell|petrobras|ale combust/, categoria: "Transporte" },
  { padrao: /estacionamento|zona azul/, categoria: "Transporte" },
  { padrao: /netflix|spotify|disney|amazon prime|hbo|paramount/, categoria: "Lazer" },
  { padrao: /cinema|cinemark|teatro/, categoria: "Lazer" },
  { padrao: /escola|faculdade|universidade|udemy|alura/, categoria: "Educação" },
  { padrao: /condom[ií]nio|imobili[aá]ria|aluguel/, categoria: "Casa" },
  { padrao: /cemig|light sa|enel|sabesp|copasa|eletropaulo/, categoria: "Casa" },
];

function sugerirCategoriaPorPalavraChave(descricaoBanco: string | null | undefined): string | null {
  if (!descricaoBanco) return null;
  const alvo = descricaoBanco.toLowerCase();
  const achado = PALAVRAS_CHAVE_CATEGORIA.find((p) => p.padrao.test(alvo));
  return achado ? achado.categoria : null;
}

/** Ver nota equivalente em pluggy-sync sobre a ordem de prioridade:
 *  (1) categoria com nome exatamente igual à descrição do banco;
 *  (2) heurística por palavra-chave do estabelecimento;
 *  (3) categoria da Pluggy já traduzida. */
function sugerirCategoria(
  categoriaTraduzida: string | null,
  descricaoBanco: string | null | undefined,
  tipo: "entradas" | "saidas",
  categoriasApp: { nome: string; categoria_tipo: string | null }[],
): string | null {
  const candidatas = categoriasApp.filter((c) => c.categoria_tipo === tipo);

  const descNorm = (descricaoBanco || "").trim().toLowerCase();
  if (descNorm) {
    const exataDescricao = candidatas.find((c) => c.nome.toLowerCase() === descNorm);
    if (exataDescricao) return exataDescricao.nome;
  }

  const porPalavraChave = sugerirCategoriaPorPalavraChave(descricaoBanco);
  if (porPalavraChave) {
    const achada = candidatas.find((c) => c.nome.toLowerCase() === porPalavraChave.toLowerCase());
    if (achada) return achada.nome;
  }

  if (categoriaTraduzida) {
    const alvo = categoriaTraduzida.trim().toLowerCase();
    const exata = candidatas.find((c) => c.nome.toLowerCase() === alvo);
    if (exata) return exata.nome;
    const parcial = candidatas.find(
      (c) => alvo.includes(c.nome.toLowerCase()) || c.nome.toLowerCase().includes(alvo),
    );
    if (parcial) return parcial.nome;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Método não suportado" }, 405);
  }

  try {
    // Segredo próprio na query string — a Pluggy não manda JWT nosso, então
    // esta é a única barreira antes de gastar chamadas na API da Pluggy.
    const url = new URL(req.url);
    const secretRecebido = url.searchParams.get("wh");
    const secretEsperado = Deno.env.get("PLUGGY_WEBHOOK_SECRET");
    if (!secretEsperado || secretRecebido !== secretEsperado) {
      return json({ error: "Não autorizado" }, 401);
    }

    // O corpo é tratado como não confiável: só usamos o itemId como
    // gatilho, nunca valores como amount/description/category dele.
    let payload: { itemId?: string; event?: string } = {};
    try {
      payload = await req.json();
    } catch {
      // corpo vazio/inválido — ainda assim tenta seguir (alguns eventos
      // de teste do dashboard da Pluggy mandam corpo vazio).
    }
    const itemId = payload?.itemId;
    if (!itemId) {
      return json({ ok: true, ignorado: "payload sem itemId" });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: contas, error: contasError } = await supabaseAdmin
      .from("pluggy_contas")
      .select("*")
      .eq("item_id", itemId)
      .in("status", ["ativo", "erro"]);
    if (contasError) {
      console.error(contasError);
      return json({ error: "Falha ao carregar contas" }, 500);
    }
    if (!contas || !contas.length) {
      // itemId de outro ambiente, conta desconectada, etc. — não é erro.
      return json({ ok: true, ignorado: "item não encontrado ou sem contas ativas" });
    }

    const userId = contas[0].user_id;
    const { data: categoriasApp } = await supabaseAdmin
      .from("menu_itens")
      .select("nome, categoria_tipo")
      .eq("tipo", "Categoria")
      .eq("status", "Ativo")
      .eq("user_id", userId);

    const apiKey = await getPluggyApiKey();
    let novasNoTotal = 0;

    for (const conta of contas) {
      const dateFrom = conta.ultimo_sync
        ? String(conta.ultimo_sync).slice(0, 10)
        : new Date(Date.now() - DIAS_HISTORICO_PRIMEIRA_SYNC * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      try {
        const linhas: Record<string, unknown>[] = [];
        let path: string | null =
          `/v2/transactions?accountId=${conta.account_id}&dateFrom=${dateFrom}`;
        while (path) {
          const resp = await pluggyGet(path, apiKey);
          for (const t of resp.results ?? []) {
            // Ver nota equivalente em pluggy-sync: CREDIT = entrada, DEBIT =
            // saída pra conta e cartão igual — a inversão pro cartão que
            // existia aqui antes só valia pro conector sandbox de teste.
            const tipo: "entradas" | "saidas" = t.type === "CREDIT" ? "entradas" : "saidas";
            const categoriaTraduzida = t.category ? traduzirCategoriaPluggy(t.category) : null;
            // "Rendimentos e dividendos" (juros de conta remunerada etc.) nunca
            // entra na fila nem manda aviso — são muitos e minúsculos, sem
            // toggle aqui (diferente do "Sincronizar agora" do app): sempre
            // ignorado no aviso em tempo real do bot.
            if (categoriaTraduzida === "Rendimentos e dividendos") continue;
            const descricaoBanco = t.description || t.descriptionRaw || "";
            linhas.push({
              pluggy_transaction_id: t.id,
              conta_id: conta.id,
              data: String(t.date ?? "").slice(0, 10),
              valor: Math.abs(Number(t.amount) || 0),
              tipo,
              descricao_banco: descricaoBanco,
              categoria_pluggy: categoriaTraduzida,
              categoria_sugerida: sugerirCategoria(categoriaTraduzida, descricaoBanco, tipo, categoriasApp ?? []),
              metodo_sugerido: conta.metodo_id ?? null,
              status: ehMovimentoInterno(t.operationType) ? "ignorada" : "pendente",
              user_id: conta.user_id,
            });
          }
          path = resp.next ? `/v2/transactions?${String(resp.next).replace(/^\?/, "")}` : null;
        }

        if (linhas.length) {
          const { data: inseridas, error: upsertError } = await supabaseAdmin
            .from("transacoes_importadas")
            .upsert(linhas, { onConflict: "user_id,pluggy_transaction_id", ignoreDuplicates: true })
            .select("id, tipo, valor, data, descricao_banco, categoria_sugerida, metodo_sugerido, status");
          if (upsertError) throw upsertError;
          const pendentes = (inseridas ?? []).filter((i) => i.status === "pendente");
          // Já existe lançamento igual (manual/bot)? Concilia e não avisa.
          const conciliados = await conciliarComExistentes(supabaseAdmin, conta.user_id, pendentes);
          const paraAvisar = pendentes.filter((i) => !conciliados.has(i.id));
          novasNoTotal += paraAvisar.length;
          await notificarTelegramNovas(supabaseAdmin, conta.user_id, paraAvisar);
        }

        if (conta.tipo_conta === "CREDIT") await guardarFaturasBanco(supabaseAdmin, conta.user_id, conta.id, conta.account_id, apiKey);

        let saldoAtual: number | null = null;
        try {
          const acc = await pluggyGet(`/accounts/${conta.account_id}`, apiKey);
          if (typeof acc?.balance === "number") saldoAtual = acc.balance;
        } catch (e) {
          console.error(`Saldo indisponível (conta ${conta.id}):`, e);
        }
        await supabaseAdmin
          .from("pluggy_contas")
          .update({ ultimo_sync: new Date().toISOString(), status: "ativo", ...(saldoAtual !== null ? { saldo: saldoAtual } : {}) })
          .eq("id", conta.id);
      } catch (e) {
        console.error(`Erro sincronizando conta ${conta.id} via webhook:`, e);
        await supabaseAdmin.from("pluggy_contas").update({ status: "erro" }).eq("id", conta.id);
      }
    }

    return json({ ok: true, novas: novasNoTotal, contasProcessadas: contas.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

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

const PLUGGY_API_URL = "https://api.pluggy.ai";
const DIAS_HISTORICO_PRIMEIRA_SYNC = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
              status: "pendente",
              user_id: conta.user_id,
            });
          }
          path = resp.next ? `/v2/transactions?${String(resp.next).replace(/^\?/, "")}` : null;
        }

        if (linhas.length) {
          const { data: inseridas, error: upsertError } = await supabaseAdmin
            .from("transacoes_importadas")
            .upsert(linhas, { onConflict: "user_id,pluggy_transaction_id", ignoreDuplicates: true })
            .select("id");
          if (upsertError) throw upsertError;
          novasNoTotal += inseridas?.length ?? 0;
        }

        await supabaseAdmin
          .from("pluggy_contas")
          .update({ ultimo_sync: new Date().toISOString(), status: "ativo" })
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

// Edge Function: pluggy-item-conectado
//
// Chamada pelo client logo depois que o widget Pluggy Connect termina com
// sucesso (onSuccess -> itemData.item.id). Busca as contas desse item na
// Pluggy e grava uma linha em public.pluggy_contas por conta/cartão — o
// usuário associa cada uma a um Método do app depois, manualmente.
//
// Segredos usados: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET.
// Ver plano da integração: memória "app-financeiro-pluggy-integracao".

import { createClient } from "npm:@supabase/supabase-js@2";

const PLUGGY_API_URL = "https://api.pluggy.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método não suportado" }, 405);
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Não autenticado" }, 401);
    }

    const { itemId } = await req.json();
    if (!itemId) {
      return json({ error: "itemId é obrigatório" }, 400);
    }

    const apiKey = await getPluggyApiKey();

    // Nome da instituição vem do item (connector); as contas em si não trazem isso.
    const item = await pluggyGet(`/items/${itemId}`, apiKey);
    const nomeInstituicao: string = item?.connector?.name || "Conta conectada";

    const accountsResp = await pluggyGet(`/accounts?itemId=${itemId}`, apiKey);
    const contas = accountsResp?.results || [];
    if (!contas.length) {
      return json({ error: "Nenhuma conta encontrada para esse item" }, 502);
    }

    // Grava com a service role (contorna RLS de forma explícita e segura:
    // usamos o user.id já verificado acima, nunca um valor vindo do client).
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Guarda o máximo de detalhe que a Pluggy dá pra diferenciar contas do
    // mesmo conector (ex.: "MeuPluggy" agrega várias instituições reais) —
    // sem isso a tela de Contas conectadas mostrava só o nome do conector,
    // igual pra todas, e o usuário não conseguia saber qual conta era qual
    // na hora de associar o Método do app.
    type ContaPluggy = {
      id: string;
      type: string;
      name?: string;
      marketingName?: string | null;
      number?: string | null;
      balance?: number | null;
      creditData?: { brand?: string | null; level?: string | null } | null;
    };
    const linhas = contas.map((conta: ContaPluggy) => ({
      item_id: itemId,
      account_id: conta.id,
      nome_instituicao: nomeInstituicao,
      tipo_conta: conta.type === "CREDIT" ? "CREDIT" : "BANK",
      nome_conta: conta.name || null,
      marketing_name: conta.marketingName || null,
      numero_mascarado: conta.number || null,
      marca_cartao: conta.creditData?.brand || null,
      saldo: typeof conta.balance === "number" ? conta.balance : null,
      // Melhor esforço: conectores que agregam várias instituições reais
      // (ex.: "MeuPluggy") não dizem o banco de origem por conta — quando a
      // Pluggy manda um marketingName específico usamos ele, senão fica em
      // branco pro usuário preencher na tela (Contas conectadas).
      banco_origem: conta.marketingName || null,
      status: "ativo",
      user_id: user.id,
    }));

    const { data: gravadas, error: dbError } = await supabaseAdmin
      .from("pluggy_contas")
      .upsert(linhas, { onConflict: "user_id,account_id" })
      .select();

    if (dbError) {
      return json({ error: "Falha ao gravar contas", detalhe: dbError.message }, 500);
    }

    return json({ contas: gravadas });
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

// Edge Function: pluggy-excluir-conta
//
// Apaga de vez uma linha de public.pluggy_contas (diferente de "desconectar",
// que só marca status='desconectado' e mantém a linha). Bloqueada se a conta
// tiver alguma transacoes_importadas com status='confirmada' — apagar a
// conta cascadeia (on delete cascade) e apagaria também esse histórico, e
// como o dedup por pluggy_transaction_id some junto, uma reconexão futura
// da mesma conta reimportaria as transações antigas e o usuário poderia
// confirmar de novo, duplicando o lançamento real em public.transacoes.
//
// Se essa era a última conta ligada ao item na Pluggy, também tenta encerrar
// o item lá (DELETE /items/{itemId}) pra não reimportar nada no futuro —
// melhor esforço, não bloqueia a exclusão local se falhar.
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

    const { contaId } = await req.json();
    if (!contaId) {
      return json({ error: "contaId é obrigatório" }, 400);
    }

    // RLS já garante que só vem conta do próprio usuário.
    const { data: conta, error: contaError } = await supabaseClient
      .from("pluggy_contas")
      .select("*")
      .eq("id", contaId)
      .single();
    if (contaError || !conta) {
      return json({ error: "Conta não encontrada" }, 404);
    }

    const { count: confirmadas, error: countError } = await supabaseClient
      .from("transacoes_importadas")
      .select("id", { count: "exact", head: true })
      .eq("conta_id", contaId)
      .eq("status", "confirmada");
    if (countError) {
      return json({ error: "Falha ao checar histórico da conta", detalhe: countError.message }, 500);
    }
    if (confirmadas && confirmadas > 0) {
      return json({
        error: `Essa conta tem ${confirmadas} transação(ões) confirmada(s) — apagar removeria esse histórico. Use "Desconectar" em vez de apagar.`,
      }, 409);
    }

    // Só encerra o item na Pluggy se não sobrar mais nenhuma conta ligada a
    // ele (um item pode ter várias contas, ex.: conta corrente + cartão).
    const { count: outrasContasDoItem } = await supabaseClient
      .from("pluggy_contas")
      .select("id", { count: "exact", head: true })
      .eq("item_id", conta.item_id)
      .neq("id", contaId);
    if (!outrasContasDoItem) {
      try {
        const apiKey = await getPluggyApiKey();
        await fetch(`${PLUGGY_API_URL}/items/${conta.item_id}`, {
          method: "DELETE",
          headers: { "X-API-KEY": apiKey },
        });
      } catch (e) {
        // Melhor esforço: não bloqueia a exclusão local por causa disso.
        console.error(`Falha ao encerrar item ${conta.item_id} na Pluggy:`, e);
      }
    }

    // Cascateia a exclusão das transacoes_importadas 'pendente'/'ignorada'
    // dessa conta (já garantimos acima que não há 'confirmada').
    const { error: deleteError } = await supabaseClient
      .from("pluggy_contas")
      .delete()
      .eq("id", contaId);
    if (deleteError) {
      return json({ error: "Falha ao apagar conta", detalhe: deleteError.message }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

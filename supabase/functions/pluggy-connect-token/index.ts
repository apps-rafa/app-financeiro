// Edge Function: pluggy-connect-token
//
// Gera um "connect token" da Pluggy para o widget Pluggy Connect abrir no
// browser. Requer um JWT válido do Supabase (verify_jwt ligado no deploy) —
// o usuário só pode gerar um token pra conectar uma conta na própria conta
// dele (clientUserId = auth.uid()).
//
// Segredos usados (Supabase Edge Functions → Secrets):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET

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

/** Troca CLIENT_ID/CLIENT_SECRET por uma API Key da Pluggy (expira em 2h). */
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
    // Identifica o usuário a partir do JWT que o client já mandou (o próprio
    // runtime da Edge Function já validou a assinatura antes de chegar aqui).
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Não autenticado" }, 401);
    }

    const apiKey = await getPluggyApiKey();

    const webhookSecret = Deno.env.get("PLUGGY_WEBHOOK_SECRET") ?? "";
    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const webhookUrl = `${projectUrl}/functions/v1/pluggy-webhook?wh=${encodeURIComponent(webhookSecret)}`;

    const resp = await fetch(`${PLUGGY_API_URL}/connect_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        options: { clientUserId: user.id, webhookUrl },
      }),
    });
    if (!resp.ok) {
      return json({ error: "Falha ao gerar connect token", detalhe: await resp.text() }, 502);
    }
    const data = await resp.json();
    return json({ accessToken: data.accessToken });
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

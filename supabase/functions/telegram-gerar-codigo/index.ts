// Edge Function: telegram-gerar-codigo
//
// Chamada pelo client (usuário logado) ao clicar "Conectar Telegram" em
// Importar > Pluggy. Gera um código curto de uso único (válido por 10
// minutos, consumido por telegram-webhook quando o usuário manda
// "/start CODIGO" no bot) e devolve o link pronto t.me/<bot>?start=CODIGO.

import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_USERNAME = "appCtrlFin_bot";

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

function gerarCodigo(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I — evita confusão
  let codigo = "";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) codigo += alfabeto[b % alfabeto.length];
  return codigo;
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

    // Um código pendente por vez — limpa os anteriores antes de gerar outro.
    await supabaseClient.from("telegram_link_codes").delete().eq("user_id", user.id);

    const codigo = gerarCodigo();
    const { error: insertError } = await supabaseClient
      .from("telegram_link_codes")
      .insert({ code: codigo, user_id: user.id });
    if (insertError) throw insertError;

    return json({ codigo, botUsername: BOT_USERNAME, link: `https://t.me/${BOT_USERNAME}?start=${codigo}` });
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

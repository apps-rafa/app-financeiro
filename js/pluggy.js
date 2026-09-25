/**
 * PLUGGY — conexão de contas bancárias (open finance).
 * Vive dentro de Configurações > Importar > Pluggy, com a mesma cara de
 * CSV/PDF: conectar/gerenciar contas, sincronizar, e revisar os
 * lançamentos importados numa lista com grupo de possíveis duplicatas —
 * confirmar grava um lançamento de verdade, ignorar só marca a linha.
 */

// Versão fixa do SDK (não usar "latest" — evita quebra silenciosa).
const PLUGGY_SDK_URL = 'https://cdn.jsdelivr.net/npm/pluggy-connect-sdk@2.14.2/+esm';
// TODO: desligar quando o app for conectar contas reais (produção) — e
// junto com isso, remover o filtro connectorIds abaixo.
const PLUGGY_INCLUDE_SANDBOX = true;
// Restringe o widget aos conectores de teste conhecidos (ids fixos, via
// GET /connectors?sandbox=true na API da Pluggy):
//   2   = "Pluggy Bank"  — sandbox usuário/senha (user-ok / password-ok)
//   200 = "MeuPluggy"    — demo próprio da Pluggy, fluxo OAuth
const PLUGGY_CONNECTOR_IDS = [2, 200];

let _PluggyConnectCtor = null;
// Estado aberto/fechado dos 2 grupos de contas — sobrevive a re-renders
// (ex.: depois de (des)conectar uma conta). Os dois começam fechados.
const _abertosPluggyContas = { conectadas: false, desconectadas: false };

/** Banco de uma conta Pluggy. O conector "MeuPluggy" agrega vários bancos e
 *  não diz qual é o de cada conta, então a fonte mais confiável é o banco do
 *  "Método do app" ligado à conta; depois o nome de marketing sem o "(...)".
 *  Mesma regra do telegram-webhook (tituloContaPluggyDetalhado). */
function _bancoContaPluggy(c) {
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const metodo = c.metodo_id ? metodos.find(m => m.id === c.metodo_id) : null;
    const marketing = c.marketing_name || '';
    const bruto = (metodo && metodo.banco)
        || (marketing ? marketing.replace(/\s*\([^)]*\)\s*$/, '') : null)
        || (c.nome_instituicao && !/meupluggy/i.test(c.nome_instituicao) ? c.nome_instituicao : null);
    if (!bruto) return null;
    // "Nu Pagamentos S.A. - Instituição de Pagamento" -> "Nubank"
    if (/^nu pagamentos/i.test(bruto.trim())) return 'Nubank';
    return bruto.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Nome padrão da conta ("Banco: Tipo") — o mesmo do Telegram:
 *    Mercado Pago: Conta Pré-paga
 *    Bradesco: Cartão de crédito VISA INFINITE (final 1525) */
function tituloContaPluggy(c) {
    const banco = _bancoContaPluggy(c);
    if (c.tipo_conta === 'CREDIT') {
        const marca = (c.marca_cartao || '').toUpperCase();
        const nivel = (c.nome_conta || '').toUpperCase(); // "VISA INFINITE", "PLATINUM" ou o próprio banco
        let detalhe;
        if (nivel && marca && nivel.includes(marca)) detalhe = nivel;
        else if (nivel && banco && nivel === banco.toUpperCase()) detalhe = marca;
        else detalhe = [marca, nivel].filter(Boolean).join(' ');
        const cartao = `Cartão de crédito${detalhe ? ' ' + detalhe : ''}${c.numero_mascarado ? ` (final ${c.numero_mascarado})` : ''}`;
        return banco ? `${banco}: ${cartao}` : cartao;
    }
    const entreParenteses = (c.marketing_name || '').match(/\(([^)]+)\)\s*$/)?.[1];
    const tipo = entreParenteses || c.nome_conta || 'Conta bancária';
    return banco ? `${banco}: ${tipo}` : tipo;
}

/** Nome curto pros botões de escolher contas do sync: "Bradesco: Crédito",
 *  "Mercado Pago: Conta". */
function tituloContaPluggyCurto(c) {
    const tipo = c.tipo_conta === 'CREDIT' ? 'Crédito' : 'Conta';
    const banco = _bancoContaPluggy(c);
    return banco ? `${banco}: ${tipo}` : tipo;
}

// Mesma heurística do servidor (supabase/functions/pluggy-sync e
// pluggy-webhook) — duplicada aqui só pra também sugerir categoria nas
// linhas que já estavam na fila antes dessa lógica existir no servidor.
const PALAVRAS_CHAVE_CATEGORIA_PLUGGY = [
    { padrao: /drogaria|farm[aá]cia|droga ?raia|pacheco|pague ?menos/, categoria: 'Saúde' },
    { padrao: /hospital|cl[ií]nica|laborat[oó]rio|dentista|odont/, categoria: 'Saúde' },
    { padrao: /academia|smart ?fit|bodytech|bio ?ritmo/, categoria: 'Saúde' },
    { padrao: /supermercado|hortifruti|atacad[ãa]o|carrefour|extra|p[ãa]o de a[çc][uú]car|assa[íi]/, categoria: 'Mercado' },
    { padrao: /restaurante|lanchonete|padaria|pizzaria|churrascaria/, categoria: 'Alimentação' },
    { padrao: /ifood|rappi|mcdonalds|burger king|habib|subway/, categoria: 'Alimentação' },
    { padrao: /uber|99app|99pop|t[áa]xi/, categoria: 'Transporte' },
    { padrao: /posto|ipiranga|shell|petrobras|ale combust/, categoria: 'Transporte' },
    { padrao: /estacionamento|zona azul/, categoria: 'Transporte' },
    { padrao: /netflix|spotify|disney|amazon prime|hbo|paramount/, categoria: 'Lazer' },
    { padrao: /cinema|cinemark|teatro/, categoria: 'Lazer' },
    { padrao: /escola|faculdade|universidade|udemy|alura/, categoria: 'Educação' },
    { padrao: /condom[ií]nio|imobili[aá]ria|aluguel/, categoria: 'Casa' },
    { padrao: /cemig|light sa|enel|sabesp|copasa|eletropaulo/, categoria: 'Casa' },
];

function sugerirCategoriaPorPalavraChavePluggy(descricaoBanco) {
    if (!descricaoBanco) return null;
    const alvo = descricaoBanco.toLowerCase();
    const achado = PALAVRAS_CHAVE_CATEGORIA_PLUGGY.find(p => p.padrao.test(alvo));
    return achado ? achado.categoria : null;
}

/** Sugestão de categoria calculada no cliente (fallback quando a linha já
 *  tem categoria_sugerida nula, gravada antes dessa heurística existir).
 *  categoriasApp é a lista de nomes (string) do tipo entrada/saída certo —
 *  mesmo formato que estadoApp.menus.categoriasReceita/categoriasDespesa. */
function sugerirCategoriaClientePluggy(item, categoriasApp) {
    const descNorm = (item.descricao_banco || '').trim().toLowerCase();
    if (descNorm) {
        const exata = categoriasApp.find(nome => nome.toLowerCase() === descNorm);
        if (exata) return exata;
    }
    const porPalavraChave = sugerirCategoriaPorPalavraChavePluggy(item.descricao_banco);
    if (porPalavraChave) {
        const achada = categoriasApp.find(nome => nome.toLowerCase() === porPalavraChave.toLowerCase());
        if (achada) return achada;
    }
    if (item.categoria_pluggy) {
        const alvo = item.categoria_pluggy.trim().toLowerCase();
        const exata = categoriasApp.find(nome => nome.toLowerCase() === alvo);
        if (exata) return exata;
        const parcial = categoriasApp.find(nome => alvo.includes(nome.toLowerCase()) || nome.toLowerCase().includes(alvo));
        if (parcial) return parcial;
    }
    return null;
}

/** Carrega o SDK da Pluggy sob demanda (só quando o usuário clica em conectar). */
async function carregarPluggyConnectSdk() {
    if (!_PluggyConnectCtor) {
        const mod = await import(PLUGGY_SDK_URL);
        _PluggyConnectCtor = mod.PluggyConnect;
    }
    return _PluggyConnectCtor;
}

/** Abre o widget Pluggy Connect para conectar uma conta nova. */
async function conectarContaPluggy() {
    try {
        const { data, error } = await sb.functions.invoke('pluggy-connect-token', { body: {} });
        if (error || !data?.accessToken) {
            throw error || new Error('Resposta sem accessToken');
        }

        const PluggyConnect = await carregarPluggyConnectSdk();
        const widget = new PluggyConnect({
            connectToken: data.accessToken,
            includeSandbox: PLUGGY_INCLUDE_SANDBOX,
            connectorIds: PLUGGY_CONNECTOR_IDS,
            onSuccess: async ({ item }) => {
                await finalizarConexaoPluggy(item.id);
            },
            onError: (erro) => {
                console.error(erro);
                mostrarNotificacao('Erro ao conectar: ' + (erro?.message || 'desconhecido'), 'erro');
            },
        });
        await widget.init();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao iniciar conexão com a Pluggy', 'erro');
    }
}

/** Grava as contas do item recém-conectado e atualiza a lista na tela. */
async function finalizarConexaoPluggy(itemId) {
    try {
        const { data, error } = await sb.functions.invoke('pluggy-item-conectado', { body: { itemId } });
        if (error) throw error;
        mostrarNotificacao(`${data?.contas?.length || 0} conta(s) conectada(s)`, 'sucesso');
        await carregarContasConectadas();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Conta conectada na Pluggy, mas houve erro ao salvar aqui — recarregue a página', 'erro');
    }
}

let _ultimaAtualizacaoSaldos = 0;
/** Pede pro servidor buscar na Pluggy o saldo atual das contas e as faturas dos
 *  cartões (sem mexer na fila de revisão) e recarrega o dashboard. Roda ao abrir
 *  o app e ao voltar pra ele (no máximo 1x a cada 3 min fora do primeiro
 *  carregamento). Falha silenciosa — mostra o último valor guardado. */
async function atualizarSaldosPluggy(forcar = false) {
    if (!forcar && Date.now() - _ultimaAtualizacaoSaldos < 3 * 60 * 1000) return;
    _ultimaAtualizacaoSaldos = Date.now();
    try {
        await sb.functions.invoke('pluggy-sync', { body: { soSaldos: true } });
    } catch (e) {
        console.warn('Atualização de saldos indisponível:', e);
    }
    await carregarSaldoContas();
    await carregarFaturasBanco();
}

/** Soma o saldo das contas BANCÁRIAS conectadas (Open Finance) pro cartão
 *  "Saldo em contas" do dashboard; sem nenhuma conta com saldo, esconde. */
async function carregarSaldoContas() {
    const { data, error } = await sb.from('pluggy_contas')
        .select('*').eq('tipo_conta', 'BANK').in('status', ['ativo', 'erro']).order('id');
    if (error) { console.error(error); return; }
    const contas = (data || []).filter(c => typeof c.saldo === 'number');
    estadoApp.saldoContasLista = contas.map(c => ({ nome: tituloContaPluggyCurto(c), saldo: c.saldo }));
    estadoApp.saldoContas = contas.length ? contas.reduce((a, c) => a + c.saldo, 0) : null;
    if (typeof atualizarResumo === 'function') atualizarResumo();
}

/** UUID determinístico do parcelamento: a mesma compra parcelada (mesma conta,
 *  descrição sem o "k/n", nº de parcelas e valor) cai sempre no MESMO grupo,
 *  então as parcelas dos meses seguintes se juntam a ele sozinhas. */
async function _grupoIdParcelamentoPluggy(item) {
    const base = String(item.descricao_banco || '').toLowerCase()
        .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, '').replace(/\s+/g, ' ').trim();
    const semente = `parcelamento|${item.conta_id}|${base}|${item.parcelas_total}|${Number(item.valor).toFixed(2)}`;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semente));
    const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Importa UMA parcela (k de n) que o banco trouxe, já dentro do parcelamento
 *  da compra — só essa linha (as outras chegam nos meses seguintes, cada uma
 *  na sua fatura) — com o chip "k/n" e o total da compra. */
async function _adicionarParcelaPluggyAPI(dados, item) {
    const n = item.parcelas_total, k = item.parcela_num;
    const registro = montarRegistro({ ...dados, tipoRecorrencia: 'Parcelada' });
    registro.grupo_id = await _grupoIdParcelamentoPluggy(item);
    registro.parcelas_total = n;
    registro.parcela_num = k;
    registro.valor_total = Math.round(Number(item.valor) * n * 100) / 100;
    const { data, error } = await sb.from('transacoes').insert(registro).select().single();
    if (error) throw error;
    return mapearTransacao(data);
}

/** Ids dos lançamentos (manuais ou do bot) já conciliados com uma transação do
 *  banco — ganham o selo 🏦 nas listas. Os que vieram do próprio Pluggy não
 *  precisam (são do banco por definição). */
async function carregarConciliadas() {
    const { data, error } = await sb.from('transacoes_importadas')
        .select('transacao_id').eq('status', 'confirmada').not('transacao_id', 'is', null);
    if (error) { console.error(error); return; }
    estadoApp.conciliadas = new Set((data || []).map(r => r.transacao_id));
}

/** Faturas do banco (pluggy_faturas) por cartão — o Próximos compara o total
 *  lançado no app com o total da fatura do banco (ver renderFaturasCartao). */
async function carregarFaturasBanco() {
    const [{ data: faturas, error: e1 }, { data: contas, error: e2 }] = await Promise.all([
        sb.from('pluggy_faturas').select('conta_id, vencimento, total'),
        sb.from('pluggy_contas').select('id, metodo_id').eq('tipo_conta', 'CREDIT'),
    ]);
    if (e1 || e2) { console.error(e1 || e2); return; }
    const metodoDaConta = new Map((contas || []).map(c => [c.id, c.metodo_id]));
    estadoApp.faturasBanco = (faturas || [])
        .map(f => ({ metodoId: metodoDaConta.get(f.conta_id) ?? null, vencimento: f.vencimento, total: f.total }))
        .filter(f => f.metodoId != null && f.vencimento && typeof f.total === 'number');
    if (document.getElementById('proximas')?.classList.contains('active') && typeof atualizarProximasTransacoes === 'function') atualizarProximasTransacoes();
}

/** Carrega e renderiza as contas conectadas (Importar > Pluggy). */
async function carregarContasConectadas() {
    const container = document.getElementById('pluggyContasList');
    if (!container) return;

    const { data, error } = await sb
        .from('pluggy_contas')
        .select('*')
        .order('criado_em', { ascending: false });

    if (error) {
        console.error(error);
        container.innerHTML = '<p class="empty-text">Erro ao carregar contas conectadas</p>';
        return;
    }
    if (!data || !data.length) {
        container.innerHTML = '<p class="empty-text">Nenhuma conta conectada ainda</p>';
        container.onclick = null;
        container.onchange = null;
        _renderSeletorContasSyncPluggy([]);
        return;
    }

    const conectadas = data.filter(c => c.status !== 'desconectado');
    const desconectadas = data.filter(c => c.status === 'desconectado');
    _renderSeletorContasSyncPluggy(conectadas);

    const grupo = (id, titulo, lista, aberto) => !lista.length ? '' : `
        <details class="pluggy-contas-grupo" data-grupo-id="${id}" ${aberto ? 'open' : ''}>
            <summary class="pluggy-contas-grupo-titulo">${titulo} (${lista.length})</summary>
            ${lista.map(gerarHTMLContaPluggy).join('')}
        </details>`;

    container.innerHTML =
        grupo('conectadas', 'Conectadas', conectadas, _abertosPluggyContas.conectadas) +
        grupo('desconectadas', 'Desconectadas', desconectadas, _abertosPluggyContas.desconectadas);

    container.querySelectorAll('details.pluggy-contas-grupo').forEach(det => {
        det.addEventListener('toggle', () => {
            _abertosPluggyContas[det.dataset.grupoId] = det.open;
        });
    });

    container.onclick = onContasConectadasClick;
    container.onchange = onContasConectadasChange;
}

/** Botões (uma por conta conectada) que escolhem quais contas entram no
 *  "Sincronizar" — fica entre a linha de mês/Total/Rendimentos e a de
 *  Sincronizar/Limpar. Liga/desliga a mesma coluna `sincronizar` que o
 *  pluggy-sync já respeita. */
let _syncZeradoPluggy = false;
function _renderSeletorContasSyncPluggy(conectadas) {
    const box = document.getElementById('pluggyContasSync');
    if (!box) return;
    box.hidden = !conectadas.length;
    // Por padrão nenhuma conta vem escolhida: na 1ª vez em cada carga da
    // página zera a coluna (o pluggy-sync lê dela) e mostra tudo desmarcado.
    if (!_syncZeradoPluggy && conectadas.length) {
        _syncZeradoPluggy = true;
        conectadas.filter(c => c.sincronizar).forEach(c => {
            c.sincronizar = false;
            associarSincronizarConta(c.id, false);
        });
    }
    // Dois cartões do mesmo banco dariam o mesmo nome curto — desempata
    // com o final do cartão.
    const nomes = conectadas.map(tituloContaPluggyCurto);
    box.innerHTML = conectadas.map((c, i) => {
        const repetido = nomes.filter(n => n === nomes[i]).length > 1;
        const nome = repetido && c.numero_mascarado ? `${nomes[i]} (${String(c.numero_mascarado).slice(-4)})` : nomes[i];
        // Classe própria (não .pluggy-toggle-opt): o toggle de Rendimentos
        // consulta/limpa TODOS os .pluggy-toggle-opt do documento.
        return `<button type="button" class="pluggy-conta-sync ${c.sincronizar ? 'active' : ''}"
            data-id="${c.id}" data-sincronizar="${c.sincronizar ? '1' : '0'}"
            title="${c.sincronizar ? 'Incluída' : 'Fora'} no Sincronizar — clique pra ${c.sincronizar ? 'tirar' : 'incluir'}">${nome}</button>`;
    }).join('');
    box.onclick = e => {
        const btn = e.target.closest('button[data-id]');
        if (!btn) return;
        const ligar = btn.dataset.sincronizar !== '1';
        btn.classList.toggle('active', ligar);
        btn.dataset.sincronizar = ligar ? '1' : '0';
        associarSincronizarConta(Number(btn.dataset.id), ligar);
        _atualizarBotaoSincronizarPluggy();
    };
    _atualizarBotaoSincronizarPluggy();
}

/** "Sincronizar" só habilita com pelo menos uma conta escolhida acima. */
function _atualizarBotaoSincronizarPluggy() {
    const btn = document.getElementById('btnSincronizarPluggy');
    if (!btn || btn.dataset.ocupado) return; // sincronizando: quem termina reavalia
    const algumaEscolhida = !!document.querySelector('#pluggyContasSync .pluggy-conta-sync.active');
    btn.disabled = !algumaEscolhida;
    btn.title = algumaEscolhida ? '' : 'Escolha pelo menos uma conta pra sincronizar';
}

/** Card de uma conta conectada (grupo "Conectadas"/"Desconectadas"). */
function gerarHTMLContaPluggy(c) {
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const desconectada = c.status === 'desconectado';
    const statusTag = c.status === 'erro' ? '<span class="pendente-badge">erro na conexão</span>' : '';
    const opcoesMetodo = metodos.map(m =>
        `<option value="${m.id}" ${c.metodo_id === m.id ? 'selected' : ''}>${rotuloMetodo(m)}</option>`
    ).join('');
    const ultimoSync = c.ultimo_sync
        ? `último sync: ${new Date(c.ultimo_sync).toLocaleString('pt-BR')}`
        : 'ainda não sincronizada';

    const saldoTxt = c.tipo_conta === 'BANK' && typeof c.saldo === 'number'
        ? `saldo: ${formatarMoeda(c.saldo)}` : '';

    // O nome padrão já leva banco, bandeira/nível e final do cartão — não
    // precisa de linha de detalhe nem de chip com o banco.
    return `
    <div class="menu-item ativo" data-conta-id="${c.id}">
        <div class="item-info">
            <div class="item-nome">${tituloContaPluggy(c)}
                ${statusTag}
            </div>
            <div class="item-descricao">${ultimoSync}</div>
            ${saldoTxt ? `<div class="item-descricao">${saldoTxt}</div>` : ''}
            <div class="item-descricao campo-metodo-conta">
                <label for="metodo-conta-${c.id}">Forma de pagamento:</label>
                <div class="campo-com-add campo-com-add--mini">
                    <select id="metodo-conta-${c.id}" data-act="metodo-conta" data-id="${c.id}">
                        <option value="">Selecione...</option>
                        ${opcoesMetodo}
                    </select>
                    <button type="button" class="btn-mini-add" data-act="add-metodo" title="Novo método">+</button>
                </div>
            </div>
        </div>
        <div class="item-actions">
            ${desconectada
                ? `<button class="btn-icon" data-act="reconectar-conta" data-id="${c.id}" title="Reconectar">🔌</button>`
                : `<button class="btn-icon btn-danger" data-act="desconectar-conta" data-id="${c.id}" title="Desconectar">🔌</button>`}
            <button class="btn-icon btn-danger" data-act="apagar-conta" data-id="${c.id}" title="Apagar">🗑️</button>
        </div>
    </div>`;
}

function onContasConectadasClick(e) {
    const btnAddMetodo = e.target.closest('[data-act="add-metodo"]');
    if (btnAddMetodo) {
        abrirNovoMetodo();
        return;
    }
    const btnDesconectar = e.target.closest('[data-act="desconectar-conta"]');
    if (btnDesconectar) {
        desconectarConta(Number(btnDesconectar.dataset.id));
        return;
    }
    const btnReconectar = e.target.closest('[data-act="reconectar-conta"]');
    if (btnReconectar) {
        reconectarConta(Number(btnReconectar.dataset.id));
        return;
    }
    const btnApagar = e.target.closest('[data-act="apagar-conta"]');
    if (btnApagar) {
        apagarConta(Number(btnApagar.dataset.id));
    }
}

function onContasConectadasChange(e) {
    const sel = e.target.closest('select[data-act="metodo-conta"]');
    if (sel) {
        associarMetodoConta(Number(sel.dataset.id), sel.value ? Number(sel.value) : null);
    }
}

async function associarSincronizarConta(contaId, sincronizar) {
    const { error } = await sb.from('pluggy_contas').update({ sincronizar }).eq('id', contaId);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao atualizar', 'erro');
    }
}

async function associarMetodoConta(contaId, metodoId) {
    const { error } = await sb.from('pluggy_contas').update({ metodo_id: metodoId }).eq('id', contaId);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao associar método', 'erro');
        return;
    }
    mostrarNotificacao('Método associado', 'sucesso');
}

/** "Desconectar": só para de sincronizar por aqui; não remove o item na Pluggy (v1). */
async function desconectarConta(contaId) {
    const { error } = await sb.from('pluggy_contas').update({ status: 'desconectado' }).eq('id', contaId);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao desconectar', 'erro');
        return;
    }
    mostrarNotificacao('Conta desconectada', 'sucesso');
    await carregarContasConectadas();
}

/** "Reconectar": volta a conta pro grupo "Conectadas" — mesmo botão de
 *  "Desconectar", que agora funciona como toggle em vez de sumir. */
async function reconectarConta(contaId) {
    const { error } = await sb.from('pluggy_contas').update({ status: 'ativo' }).eq('id', contaId);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao reconectar', 'erro');
        return;
    }
    mostrarNotificacao('Conta reconectada', 'sucesso');
    await carregarContasConectadas();
}

/** "Apagar": remove a conta de vez (diferente de desconectar). Bloqueado
 *  pelo backend se já houver transação confirmada vinda dela. */
function apagarConta(contaId) {
    mostrarDialogo({
        titulo: 'Apagar essa conta?',
        texto: 'Isso não pode ser desfeito.',
        acoes: [
            { label: 'Cancelar' },
            { label: 'Apagar', primario: true, perigo: true, onClick: async () => {
                try {
                    const { data, error } = await sb.functions.invoke('pluggy-excluir-conta', { body: { contaId } });
                    if (error) {
                        const detalhe = await error.context?.json?.().catch(() => null);
                        throw new Error(detalhe?.error || error.message);
                    }
                    if (data?.error) throw new Error(data.error);
                    mostrarNotificacao('Conta apagada', 'sucesso');
                    await carregarContasConectadas();
                } catch (e) {
                    console.error(e);
                    mostrarNotificacao(e.message || 'Erro ao apagar conta', 'erro');
                }
            } }
        ]
    });
}

/**
 * TELEGRAM — vínculo de conta pra receber avisos de lançamentos novos
 * (Importar > Pluggy > "Notificações"). O vínculo em si acontece do lado
 * do bot (usuário manda "/start CODIGO" no Telegram — ver
 * supabase/functions/telegram-webhook); aqui só geramos o código/link e
 * mostramos o status atual.
 */

async function carregarTelegramStatus() {
    const box = document.getElementById('pluggyTelegramBox');
    if (!box) return;

    const { data, error } = await sb.from('telegram_users').select('criado_em, chat_id').maybeSingle();
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty-text">Erro ao verificar o Telegram</p>';
        return;
    }

    if (data) {
        // Telegram não dá o número de celular sem um passo extra (pedir pra
        // compartilhar contato) — usa o chat_id (o único identificador que
        // já temos) mascarado no mesmo estilo de "final do número", só pra
        // ajudar a reconhecer QUAL conta foi vinculada quando há dúvida.
        const idStr = String(data.chat_id);
        const mascara = '•'.repeat(Math.max(idStr.length - 3, 3)) + idStr.slice(-3);
        box.innerHTML = `
            <div class="pluggy-telegram-status">
                <p class="item-descricao">✅ Vinculado ao Telegram desde ${new Date(data.criado_em).toLocaleDateString('pt-BR')} (ID ${mascara})</p>
                <button type="button" class="mini-btn" id="btnDesvincularTelegram">Desvincular</button>
            </div>`;
    } else {
        box.innerHTML = `
            <p class="menu-hint">Receba avisos de lançamentos novos no Telegram, com botões pra confirmar ou ignorar na hora.</p>
            <button type="button" class="btn-submit" id="btnConectarTelegram">Conectar Telegram</button>`;
    }
}

async function onClickConectarTelegram() {
    const box = document.getElementById('pluggyTelegramBox');
    if (!box) return;
    box.innerHTML = '<p class="empty-text">Gerando link...</p>';
    try {
        const { data, error } = await sb.functions.invoke('telegram-gerar-codigo', { body: {} });
        if (error || !data?.link) throw error || new Error('Resposta sem link');
        box.innerHTML = `
            <p class="menu-hint">Abra esse link no Telegram (ou mande <b>/start ${data.codigo}</b> pro
                <a href="https://t.me/${data.botUsername}" target="_blank" rel="noopener">@${data.botUsername}</a>) —
                o código vale por 10 minutos.</p>
            <div class="pluggy-telegram-acoes">
                <a class="btn-submit pluggy-telegram-link" href="${data.link}" target="_blank" rel="noopener">Abrir no Telegram</a>
                <div class="pluggy-telegram-acoes-par">
                    <button type="button" class="mini-btn" id="btnJaVincleiTelegram">Já vinculei, atualizar</button>
                    <button type="button" class="mini-btn" id="btnConectarTelegram">🔁 Gerar outro código</button>
                </div>
            </div>`;
    } catch (e) {
        console.error(e);
        box.innerHTML = '<p class="empty-text">Erro ao gerar o link — tenta de novo</p>';
    }
}

async function onClickDesvincularTelegram() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { error } = await sb.from('telegram_users').delete().eq('user_id', user.id);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao desvincular', 'erro');
        return;
    }
    mostrarNotificacao('Telegram desvinculado', 'sucesso');
    carregarTelegramStatus();
}

function onClickTelegramBox(e) {
    if (e.target.closest('#btnConectarTelegram')) { onClickConectarTelegram(); return; }
    if (e.target.closest('#btnDesvincularTelegram')) { onClickDesvincularTelegram(); return; }
    if (e.target.closest('#btnJaVincleiTelegram')) { carregarTelegramStatus(); }
}

/**
 * FILA DE REVISÃO — transações vindas do banco, aguardando confirmação.
 * Confirmar grava um lançamento de verdade (via adicionarTransacaoAPI);
 * ignorar só marca a linha, sem apagar nada.
 */

let _revisaoPluggyCache = {};
let _historicoPluggyCache = {};
// Escolhas do usuário ainda não gravadas no banco — sobrevivem a
// re-renders (selecionar categoria move a linha de "Para revisar" pra
// "Prontas" na hora, igual ao CSV/PDF; só grava de verdade quando aperta
// "Importar N lançamentos"). Chave = id da transacoes_importadas.
const _categoriaEscolhidaPluggy = {};
const _descricaoEditadaPluggy = {};
// Linhas marcadas com "X" — só marca local (esmaece/trava a linha); vão
// pra 'ignorada' no banco (e somem) só quando o usuário aperta "Importar".
const _ignoradasPluggy = new Set();
// Estado aberto/fechado dos grupos — sobrevive a re-renders.
const _abertosPluggy = {}; // id completo do grupo/subgrupo -> aberto (sem chave = padrão do grupo)
// Grupo (revisar/duplicatas/prontas) de cada linha, congelado na 1ª vez que ela
// aparece — resolver a categoria não muda a linha de grupo, só tira o vermelho.
const _grupoPluggy = {};
// Possíveis duplicatas já inicializadas com X (pra não re-marcar depois que o
// usuário reativou uma).
const _duplicatasIniciadasPluggy = new Set();

/** Toggle "Rendimentos": Agrupar/Ignorar, um ativo por vez (não checkbox). */
function _modoRendimentosPluggy() {
    return document.querySelector('.pluggy-toggle-opt.active')?.dataset.rendimentos || 'ignorar';
}

function onClickRendimentosPluggy(e) {
    const btn = e.target.closest('.pluggy-toggle-opt');
    if (!btn) return;
    document.querySelectorAll('.pluggy-toggle-opt').forEach(b => b.classList.toggle('active', b === btn));
}

// "Buscar desde": mês (tricódigo, select) + ano (com setinhas) — mês/ano
// escolhidos viram o 1º dia daquele mês como dateFrom da sincronização.
// Começa no mês/ano atual, só muda por ação do usuário (não persiste
// entre aberturas da aba).
const _syncPluggy = { mes: new Date().getMonth() + 1, ano: new Date().getFullYear() };

function _preencherSeletorSyncPluggy() {
    const sel = document.getElementById('syncMesPluggy');
    const anoEl = document.getElementById('syncAnoPluggy');
    if (!sel || !anoEl) return;
    if (!sel.options.length) {
        sel.innerHTML = MESES_TRI.map((tri, i) => `<option value="${i + 1}">${tri}</option>`).join('');
    }
    sel.value = String(_syncPluggy.mes);
    anoEl.textContent = _syncPluggy.ano;
}

function onChangeSyncMesPluggy(e) {
    _syncPluggy.mes = parseInt(e.target.value, 10) || _syncPluggy.mes;
    _atualizarTotalMesPluggy();
}

function onClickSyncAnoPluggy(delta) {
    _syncPluggy.ano += delta;
    _preencherSeletorSyncPluggy();
    _atualizarTotalMesPluggy();
}

function calcularDateFromSyncPluggy() {
    return `${_syncPluggy.ano}-${String(_syncPluggy.mes).padStart(2, '0')}-01`;
}

/** Último dia do mês escolhido no seletor "Desde" — sem isso o sync trazia
 *  tudo "a partir daquele mês até hoje" (ex.: escolher AGO trazia AGO E
 *  SET), em vez de só o mês selecionado. */
function calcularDateToSyncPluggy() {
    const ultimoDia = new Date(_syncPluggy.ano, _syncPluggy.mes, 0).getDate();
    return `${_syncPluggy.ano}-${String(_syncPluggy.mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
}

/** Caixa "Total" ao lado do seletor de mês/ano — soma (por tipo) só os
 *  lançamentos pendentes de revisão cuja DATA cai no mês/ano escolhido ali
 *  (não é o total do app inteiro, é só da fila de revisão do Pluggy). */
function _atualizarTotalMesPluggy() {
    const elReceita = document.getElementById('pluggyTotalReceita');
    const elDespesa = document.getElementById('pluggyTotalDespesa');
    if (!elReceita || !elDespesa) return;
    const competencia = `${_syncPluggy.ano}-${String(_syncPluggy.mes).padStart(2, '0')}`;
    // Crédito: vale a competência da FATURA (quando a Pluggy informa); o resto, a data.
    const itens = Object.values(_revisaoPluggyCache).filter(item =>
        String(item.competencia_fatura || item.data || '').startsWith(competencia));
    const somar = tipo => itens.filter(i => i.tipo === tipo).reduce((s, i) => s + (Number(i.valor) || 0), 0);
    elReceita.textContent = `+${formatarMoeda(somar('entradas'))}`;
    elDespesa.textContent = `-${formatarMoeda(somar('saidas'))}`;
}

/** Botão "Sincronizar agora": busca transações novas em todas as contas. */
async function sincronizarPluggyAgora() {
    _telaLimpaPluggy = false; // sincronizar mostra tudo de novo, como está no banco
    const btn = document.getElementById('btnSincronizarPluggy');
    const textoOriginal = btn ? btn.textContent : '';
    if (btn) { btn.dataset.ocupado = '1'; btn.disabled = true; btn.textContent = 'Sincronizando...'; }
    try {
        // Sincronizar SUBSTITUI o que está em tela: descarta a fila pendente
        // (ainda não importada) antes de buscar o período novo — senão trocar
        // de mês e sincronizar acumulava os meses. Ignoradas/confirmadas ficam
        // (o servidor as reconhece e não pede revisão de novo).
        const { data: { user } } = await sb.auth.getUser();
        if (!user) throw new Error('sem usuário');
        const { error: errLimpa } = await sb.from('transacoes_importadas').delete()
            .eq('user_id', user.id).eq('status', 'pendente');
        if (errLimpa) throw errLimpa;
        const dateFrom = calcularDateFromSyncPluggy();
        const body = { modoRendimentos: _modoRendimentosPluggy() };
        if (dateFrom) {
            body.dateFrom = dateFrom;
            body.dateTo = calcularDateToSyncPluggy();
        }
        const { data, error } = await sb.functions.invoke('pluggy-sync', { body });
        if (error) throw error;
        const novas = data?.novas || 0;
        mostrarNotificacao(
            novas ? `${novas} transação(ões) nova(s) pra revisar` : 'Nada novo por enquanto',
            'sucesso'
        );
        await carregarRevisaoPluggy();
        carregarSaldoContas();
        carregarFaturasBanco();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao sincronizar com a Pluggy', 'erro');
    } finally {
        if (btn) { btn.textContent = textoOriginal || '↻ Sincronizar'; delete btn.dataset.ocupado; _atualizarBotaoSincronizarPluggy(); }
    }
}

/** Botão "Limpar tudo": mesmo padrão de 2 cliques usado no resto do app
 *  (sem confirm() nativo) — apaga TODA a fila de revisão do Pluggy,
 *  pendente/ignorada/confirmada. Isso não apaga o lançamento de verdade
 *  já criado (tabela transacoes é separada) — só o "recibo" da revisão;
 *  ressincronizar depois o mesmo período reconhece que aquela transação
 *  já virou um lançamento (via pluggy_transaction_id salvo em
 *  transacoes.dados_originais) e recoloca ela direto no histórico, sem
 *  pedir revisão de novo (ver pluggy-sync). */
function onClickLimparRevisaoPluggy(e) {
    const btn = e.currentTarget;
    if (btn.dataset.armed) {
        limparFilaRevisaoPluggy(btn);
        return;
    }
    const original = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = 'confirmar?';
    btn.classList.add('armed');
    setTimeout(() => {
        if (!btn.isConnected) return;
        delete btn.dataset.armed;
        btn.textContent = original;
        btn.classList.remove('armed');
    }, 3000);
}

/** Limpa só a TELA (volta à estaca zero visualmente): nada muda no banco, todo
 *  lançamento mantém o status. Na próxima sincronização (ou ao reabrir o app)
 *  tudo reaparece, cada item no grupo que o status dele no banco manda. */
let _telaLimpaPluggy = false;
async function limparFilaRevisaoPluggy(btn) {
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    btn.textContent = '🧹 Limpar';
    _telaLimpaPluggy = true;
    await carregarRevisaoPluggy();
}

/** Marca cada item pendente como possível duplicata — mesmo tipo, mesmo
 *  valor (tolerância de 1 centavo), data a até 2 dias e, quando os dois lados
 *  têm forma de pgto., a MESMA forma — de algum lançamento já gravado no app.
 *  Busca no banco o período dos pendentes (o estadoApp só tem o mês em tela,
 *  então sincronizar outro mês nunca achava nada). Grupo à parte, igual CSV/PDF. */
async function _marcarDuplicatasPluggy(itens) {
    if (!itens.length) return [];
    const datas = itens.map(i => String(i.data).slice(0, 10)).sort();
    const ampliar = (iso, d) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
    const { data: existentes, error } = await sb.from('transacoes')
        .select('id, tipo, valor, data, metodo, origem')
        .gte('data', ampliar(datas[0], -2)).lte('data', ampliar(datas[datas.length - 1], 2));
    if (error) console.error(error);
    const pool = existentes || [];
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const rotuloDe = id => { const m = id ? metodos.find(x => x.id === id) : null; return m ? rotuloMetodo(m) : null; };
    // Conciliação: além de "suspeita", cada item guarda o lançamento manual/do
    // bot (origem que não é 'pluggy') que ele confirma — um pra um (o mesmo
    // lançamento nunca concilia 2 transações do banco), preferindo a data mais
    // próxima e a mesma forma de pgto. Ao importar, a linha do banco é LIGADA a
    // esse lançamento (🏦) em vez de descartada.
    const conciliadas = estadoApp.conciliadas || new Set();
    const usados = new Set();
    const dif = (t, item) => _diffDias(String(t.data).slice(0, 10), String(item.data).slice(0, 10));
    const casa = (t, item, rot) =>
        t.tipo === item.tipo &&
        Math.abs(Math.abs(parseFloat(t.valor)) - Math.abs(parseFloat(item.valor))) < 0.005 &&
        typeof _diffDias === 'function' && dif(t, item) <= 2 &&
        (!rot || !t.metodo || t.metodo === rot);
    const ordenados = [...itens].sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id);
    const candidatoPorItem = new Map();
    for (const item of ordenados) {
        const rot = rotuloDe(item.metodo_sugerido);
        const cands = pool
            .filter(t => t.origem !== 'pluggy' && !usados.has(t.id) && !conciliadas.has(t.id) && casa(t, item, rot))
            .sort((a, b) => ((rot && b.metodo === rot) ? 1 : 0) - ((rot && a.metodo === rot) ? 1 : 0) || dif(a, item) - dif(b, item));
        if (cands.length) { usados.add(cands[0].id); candidatoPorItem.set(item.id, cands[0].id); }
    }
    return itens.map(item => {
        const rot = rotuloDe(item.metodo_sugerido);
        const suspeita = candidatoPorItem.has(item.id) || pool.some(t => casa(t, item, rot));
        return { ...item, _duplicataSuspeita: suspeita, _candidatoId: candidatoPorItem.get(item.id) ?? null };
    });
}

/** Categoria "ao vivo" de um item: o que o usuário escolheu na revisão
 *  (ainda não gravado), senão a sugestão vinda do servidor/cliente. */
function _categoriaAoVivoPluggy(item) {
    if (item.id in _categoriaEscolhidaPluggy) return _categoriaEscolhidaPluggy[item.id];
    const categoriasApp = (estadoApp.menus &&
        (item.tipo === 'entradas' ? estadoApp.menus.categoriasReceita : estadoApp.menus.categoriasDespesa)) || [];
    return item.categoria_sugerida || sugerirCategoriaClientePluggy(item, categoriasApp) || '';
}

function _descricaoAoVivoPluggy(item) {
    return item.id in _descricaoEditadaPluggy ? _descricaoEditadaPluggy[item.id] : (item.descricao_banco || '');
}

/** Carrega e renderiza a fila de revisão (Importar > Pluggy): pendentes
 *  (divididos em duplicatas/a revisar/prontas, igual CSV/PDF) + um
 *  histórico do que já foi confirmado (revisável, não editável aqui). */
async function carregarRevisaoPluggy() {
    const container = document.getElementById('pluggyRevisaoLista');
    if (!container) return;

    if (_telaLimpaPluggy) {
        const btnL = document.getElementById('btnLimparRevisaoPluggy');
        if (btnL) btnL.disabled = true;
        container.innerHTML = '<p class="empty-message">Tela limpa — toque em "Sincronizar agora" pra ver tudo de novo</p>';
        container.onclick = null;
        container.onchange = null;
        return;
    }

    const [{ data, error }, { data: historico }, { data: contasRows }, { data: jaIgnoradasBrutas }] = await Promise.all([
        sb.from('transacoes_importadas').select('*').eq('status', 'pendente').order('data', { ascending: false }),
        // Junta com a transação de verdade — categoria/descrição podem ter
        // sido ajustadas na revisão antes de importar, diferentes do que a
        // Pluggy sugeriu originalmente (categoria_sugerida fica "congelada").
        sb.from('transacoes_importadas')
            .select('*, transacao:transacao_id(id, data, valor, tipo, categoria, descricao, metodo, competencia)')
            .eq('status', 'confirmada').order('criado_em', { ascending: false }).limit(20),
        sb.from('pluggy_contas').select('*'),
        // Marcadas com X numa revisão anterior (status 'ignorada' — ficam
        // fora da fila 'pendente' pra sempre). Sem isso, sincronizar de novo
        // um período já revisado achava "0 novas" e a tela ficava vazia,
        // sem rastro do que já tinha sido visto — agora aparecem aqui,
        // riscadas, em vez de simplesmente sumir.
        sb.from('transacoes_importadas').select('*').eq('status', 'ignorada').order('data', { ascending: false }).limit(100),
    ]);
    const contasPorId = Object.fromEntries((contasRows || []).map(c => [c.id, c]));
    const jaIgnoradas = jaIgnoradasBrutas || [];

    if (error) {
        console.error(error);
        container.innerHTML = '<p class="empty-message">Erro ao carregar a fila de revisão</p>';
        return;
    }

    const pendentesBrutos = data || [];
    const marcados = await _marcarDuplicatasPluggy(pendentesBrutos);
    _revisaoPluggyCache = Object.fromEntries(marcados.map(item => [item.id, item]));
    _atualizarTotalMesPluggy();

    // "confirmada" com transacao_id apontando pra um lançamento que não
    // existe mais (apagado no app, via FK on-delete-set-null) não deveria
    // continuar ocupando o histórico como um "Lançamento apagado" — isso é
    // lixo da revisão, não histórico de verdade. Apaga esse resíduo e
    // segue só com o que ainda tem o lançamento de verdade por trás.
    const historicoValido = (historico || []).filter(item => item.transacao);
    const historicoOrfao = (historico || []).filter(item => !item.transacao);
    if (historicoOrfao.length) {
        sb.from('transacoes_importadas').delete().in('id', historicoOrfao.map(item => item.id))
            .then(({ error }) => { if (error) console.error('Erro ao limpar histórico órfão do Pluggy:', error); });
    }
    _historicoPluggyCache = Object.fromEntries(historicoValido.map(item => [item.id, item]));

    // Em qual grupo cada linha cai é CONGELADO na 1ª vez que ela aparece
    // (mesma regra do CSV): resolver a categoria de uma linha "para revisar"
    // só tira o destaque vermelho, NÃO muda ela de grupo.
    const categoriasDoTipo = item => (estadoApp.menus &&
        (item.tipo === 'entradas' ? estadoApp.menus.categoriasReceita : estadoApp.menus.categoriasDespesa)) || [];
    const veioComSugestao = item => !!(item.categoria_sugerida || sugerirCategoriaClientePluggy(item, categoriasDoTipo(item)));
    marcados.forEach(item => {
        if (!_grupoPluggy[item.id]) {
            _grupoPluggy[item.id] = item._duplicataSuspeita ? 'duplicatas' : (veioComSugestao(item) ? 'prontas' : 'revisar');
        }
        // Possível duplicata já nasce com X (não entra), igual ao CSV/PDF —
        // o usuário reativa (↺) se for mesmo um lançamento novo.
        if (item._duplicataSuspeita && !_duplicatasIniciadasPluggy.has(item.id)) {
            _duplicatasIniciadasPluggy.add(item.id);
            _ignoradasPluggy.add(item.id);
        }
    });
    // Ids que já não estão na fila (sync/limpar) saem dos controles locais —
    // senão sobra contador/estado de linha que não existe mais.
    for (const id of Object.keys(_grupoPluggy)) if (!_revisaoPluggyCache[id]) delete _grupoPluggy[id];
    for (const id of [..._ignoradasPluggy]) if (!_revisaoPluggyCache[id]) _ignoradasPluggy.delete(id);

    const daFila = g => marcados.filter(i => _grupoPluggy[i.id] === g);
    const revisar = daFila('revisar');
    const duplicatas = daFila('duplicatas');
    const prontas = daFila('prontas');

    // "Limpar" só habilita se há algo visível pra limpar (pendentes, histórico ou já ignoradas).
    const btnLimparRevisao = document.getElementById('btnLimparRevisaoPluggy');
    if (btnLimparRevisao) btnLimparRevisao.disabled = !pendentesBrutos.length && !historicoValido.length && !jaIgnoradas.length;

    if (!pendentesBrutos.length && !historicoValido.length && !jaIgnoradas.length) {
        container.innerHTML = '<p class="empty-message">Nada pendente — toque em "Sincronizar agora" pra buscar transações novas</p>';
        container.onclick = null;
        container.onchange = null;
        return;
    }

    // Contadores AO VIVO (o grupo é congelado, o estado da linha não).
    const totalIgnoradas = _ignoradasPluggy.size;
    const prontasAoVivo = marcados.filter(i => !_ignoradasPluggy.has(i.id) && _categoriaAoVivoPluggy(i));
    const aRevisarAoVivo = marcados.filter(i => !_ignoradasPluggy.has(i.id) && !_categoriaAoVivoPluggy(i));
    // "Cancelar" só desfaz alterações manuais — sem nenhuma, não tem o que
    // desfazer e ficava parecendo um botão que não faz nada.
    const temAlteracoes = totalIgnoradas > 0
        || Object.keys(_categoriaEscolhidaPluggy).length > 0
        || Object.keys(_descricaoEditadaPluggy).length > 0;

    // Mesmo layout do CSV/PDF (js/revisao-importacao.js): grupo → subgrupos
    // Despesas/Receitas → tabela X/Data/Valor/Categoria/Descrição. Sem
    // "Forma de pgto." — o método já vem fixado pela conta em "Método do app".
    const grupo = (id, titulo, itens, nota = '') => htmlGrupoRevisao({
        id, titulo: titulo, abertos: _abertosPluggy, padraoAberto: true, itens, nota,
        tipoDe: i => i.tipo, colunas: ['Data', 'Valor', 'Categoria', 'Descrição'],
        htmlLinha: gerarHTMLImportadaPluggy,
    });

    // Histórico no MESMO visual dos grupos das páginas de Receitas/Despesas
    // (rec-grupo + subgrupos com contagem e total, cards zebrados).
    const _abertoHist = (id, padrao) => (_abertosPluggy[id] !== undefined ? _abertosPluggy[id] : padrao);
    const _somaHist = l => l.reduce((acc, i) => acc + (parseFloat(i.transacao.valor) || 0), 0);
    const tabelaHistorico = !historicoValido.length ? '' : `
        <details class="rec-grupo" data-grupo-id="pluggy-historico" style="--cor-rec: var(--primary)" ${_abertoHist('pluggy-historico', false) ? 'open' : ''}>
          <summary>
            <span class="rec-grupo-nome">📜 Já lançados (histórico)</span>
            <span class="rec-grupo-espaco"></span>
            <span class="rec-grupo-contagem">${historicoValido.length}</span>
          </summary>
          <div class="rec-grupo-itens">${['saidas', 'entradas'].map(tipo => {
            const lista = historicoValido.filter(i => (i.transacao.tipo === 'entradas') === (tipo === 'entradas'))
                .sort((x, y) => String(y.transacao.data).localeCompare(String(x.transacao.data)));
            if (!lista.length) return '';
            const id = `pluggy-historico-${tipo}`;
            return `
            <details class="subgrupo" data-grupo-id="${id}" ${_abertoHist(id, true) ? 'open' : ''}>
              <summary class="subgrupo-cab">
                <span class="subgrupo-nome">${tipo === 'entradas' ? 'Receitas' : 'Despesas'}</span>
                <span class="subgrupo-espaco"></span>
                <span class="subgrupo-contagem">${lista.length}</span>
                <span class="subgrupo-total"><span class="tot-valor">${formatarMoeda(_somaHist(lista))}</span></span>
              </summary>
              ${lista.map(gerarHTMLHistoricoPluggy).join('')}
            </details>`;
          }).join('')}</div>
        </details>`;

    // Com mais de uma conta na fila, cada conta vira um grupo (Nubank: Crédito,
    // Mercado Pago: Conta...) com os 3 grupos de sempre dentro; com uma só, fica
    // como sempre foi.
    const notaDup = `<p class="import-csv-nota">Mesmo tipo, data (± 2 dias) e valor de algo já lançado no app. Vêm com X: ao importar, cada uma é conciliada com o lançamento que já existe (ele ganha o selo 🏦), sem duplicar — clique no ↺ se for mesmo um lançamento novo.</p>`;
    const doisGrupos = (pref, lRev, lDup) =>
        grupo(`${pref}revisar`, '⚠️ Para revisar', lRev) +
        grupo(`${pref}duplicatas`, '🔁 Possíveis duplicatas — já existe algo parecido no app', lDup, notaDup);
    const blocosPorConta = () => {
        const ids = [...new Set(marcados.map(i => i.conta_id))];
        if (ids.length <= 1) return doisGrupos('pluggy-', revisar, duplicatas);
        const nomes = ids.map(id => contasPorId[id] ? tituloContaPluggyCurto(contasPorId[id]) : 'Conta');
        return ids.map((id, k) => {
            const dela = l => l.filter(i => i.conta_id === id);
            const lRev = dela(revisar), lDup = dela(duplicatas);
            const total = lRev.length + lDup.length;
            const repetido = nomes.filter(n => n === nomes[k]).length > 1;
            const c = contasPorId[id];
            const nome = repetido && c && c.numero_mascarado ? `${nomes[k]} (${String(c.numero_mascarado).slice(-4)})` : nomes[k];
            return _grupoColapsavelConciliar({
                id: `pluggy-conta-${id}`, abertos: _abertosPluggy, padraoAberto: true,
                titulo: `🏦 ${nome} (${total})`,
                corpo: doisGrupos(`pluggy-c${id}-`, lRev, lDup),
            });
        }).join('');
    };

    // Marcadas com X numa revisão anterior (status 'ignorada' no banco) — não
    // entram na fila de novo, mas ficam visíveis aqui, riscadas, em vez de
    // sumir sem deixar rastro (ver query em cima). O ↺ manda de volta pra
    // "Para revisar" (bate no banco na hora, não é local como o X normal).
    const jaIgnoradasHTML = !jaIgnoradas.length ? '' : htmlGrupoRevisao({
        id: 'pluggy-ja-ignoradas', titulo: '🗑️ Descartadas (não entraram)', abertos: _abertosPluggy, padraoAberto: false,
        itens: jaIgnoradas, tipoDe: i => i.tipo, colunas: ['Data', 'Valor', 'Categoria', 'Descrição'],
        htmlLinha: gerarHTMLIgnoradaDbPluggy,
        nota: `<p class="import-csv-nota">Ficam aqui riscadas — nunca somem da página, nem depois de "Limpar". Clique no ↺ pra mandar de volta pra "Para revisar".</p>`,
    });

    container.innerHTML = [
        `<p class="import-csv-resumo">
            <b>${pendentesBrutos.length}</b> linha${pendentesBrutos.length === 1 ? '' : 's'} na fila —
            <span class="ok">${prontasAoVivo.length} pronta${prontasAoVivo.length === 1 ? '' : 's'}</span>
            ${aRevisarAoVivo.length ? ` · <span class="alerta">${aRevisarAoVivo.length} para revisar</span>` : ''}
            ${duplicatas.length ? ` · <span class="alerta">${duplicatas.length} possível${duplicatas.length === 1 ? '' : 'is'} duplicata${duplicatas.length === 1 ? '' : 's'}</span>` : ''}
        </p>`,
        blocosPorConta(),
        jaIgnoradasHTML,
        tabelaHistorico,
        grupo('pluggy-prontas', '✓ Prontas', prontas),
        `<div class="import-csv-acoes">
            <button type="button" class="btn-submit" id="btnImportarProntasPluggy"
                title="${totalIgnoradas ? `As ${totalIgnoradas} linha(s) com X serão descartadas da fila.` : ''}"
                ${prontasAoVivo.length || totalIgnoradas ? '' : 'disabled'}>
                Importar ${prontasAoVivo.length} lançamento${prontasAoVivo.length === 1 ? '' : 's'}
            </button>
        </div>
        <div id="pluggyImportProgresso" class="import-csv-progresso" hidden></div>`,
    ].join('');

    container.querySelectorAll('details[data-grupo-id]').forEach(det => {
        det.addEventListener('toggle', () => { _abertosPluggy[det.dataset.grupoId] = det.open; });
    });

    document.getElementById('btnImportarProntasPluggy')?.addEventListener('click', importarProntasPluggy);

    container.onclick = onRevisaoPluggyClick;
    container.onchange = onRevisaoPluggyChange;
}

/** Linha da tabela de revisão (layout compartilhado — ver
 *  js/revisao-importacao.js): X, data dd/mm, valor, categoria, descrição
 *  editável. Vermelha enquanto falta categoria; esmaecida/travada com X. */
function gerarHTMLImportadaPluggy(item) {
    const ignorada = _ignoradasPluggy.has(item.id);
    const categoriasApp = (estadoApp.menus &&
        (item.tipo === 'entradas' ? estadoApp.menus.categoriasReceita : estadoApp.menus.categoriasDespesa)) || [];
    const categoriaAoVivo = _categoriaAoVivoPluggy(item);
    const opcoesCategoria = categoriasApp.map(nome =>
        `<option value="${nome}" ${nome === categoriaAoVivo ? 'selected' : ''}>${nome}</option>`
    ).join('');

    return htmlLinhaRevisao({
        atributos: `data-importada-id="${item.id}"${item.parcelas_total > 1 ? ` title="Parcela ${item.parcela_num}/${item.parcelas_total} — entra como parcelamento`+'"' : ''}`,
        ignorada, revisar: !categoriaAoVivo,
        chaveX: item.id, dataISO: item.data, valor: item.valor,
        celulasMeio: `<td>
            <select data-campo="categoria" name="categoria-${item.id}" aria-label="Categoria" title="Categoria" ${ignorada ? 'disabled' : ''}>
                <option value="">Selecione...</option>
                ${opcoesCategoria}
            </select>
        </td>`,
        editavel: true, descricao: _descricaoAoVivoPluggy(item),
    });
}

/** Linha do histórico (já confirmado) — categoria/descrição/data vêm da
 *  transação de verdade (transacao_id), não da sugestão original da
 *  Pluggy, que pode ter sido trocada na revisão antes de importar. Dá pra
 *  editar/excluir o lançamento direto daqui. */
function gerarHTMLHistoricoPluggy(item) {
    const t = item.transacao;
    // Mesmo card dos lançamentos das páginas de Receitas/Despesas; só as ações
    // são trocadas pelas do histórico (editar/excluir pelo id da fila).
    const html = gerarHTMLTransacao(mapearTransacao(t), t.tipo === 'entradas' ? 'entrada' : 'saida', { semAcoes: true });
    const acoes = `<button class="btn-icon" data-act="editar-historico" data-id="${item.id}" title="Editar">✏️</button><button class="btn-icon btn-danger" data-act="excluir-historico" data-id="${item.id}" title="Excluir">🗑️</button>`;
    return html.replace('<div class="despesa-actions"></div>', `<div class="despesa-actions">${acoes}</div>`);
}

/** Leva pro mês da transação e abre o formulário de edição — mesma tela
 *  usada pra editar qualquer lançamento, só que a partir do histórico
 *  do Pluggy (que pode estar mostrando um mês diferente do atual). */
async function editarHistoricoPluggy(id) {
    const item = _historicoPluggyCache[id];
    const t = item?.transacao;
    if (!t) return;
    const mesAtualISO = `${estadoApp.mesAtual.getFullYear()}-${String(estadoApp.mesAtual.getMonth() + 1).padStart(2, '0')}-01`;
    if (t.competencia && t.competencia !== mesAtualISO) {
        estadoApp.mesAtual = parseDataLocal(t.competencia);
        await recarregarDados();
    }
    const trans = [...estadoApp.transacoes.entradas, ...estadoApp.transacoes.saidas].find(x => x.id === t.id);
    if (!trans) {
        mostrarNotificacao('Não achei o lançamento — talvez tenha sido apagado', 'erro');
        return;
    }
    iniciarEdicaoTransacao(trans, t.tipo);
}

function excluirHistoricoPluggy(id) {
    const item = _historicoPluggyCache[id];
    const t = item?.transacao;
    if (!t) return;
    mostrarDialogo({
        titulo: 'Excluir lançamento?',
        texto: `Remove <strong>${t.descricao || t.categoria || 'este lançamento'}</strong>. Não dá para desfazer.`,
        acoes: [
            { label: 'Cancelar' },
            { label: 'Excluir', primario: true, perigo: true, onClick: async () => {
                try {
                    await deletarTransacaoAPI(t.id);
                    // Some do histórico junto — sem isso a linha ficaria
                    // "confirmada" apontando pra uma transação que não existe mais.
                    await sb.from('transacoes_importadas').update({ status: 'ignorada' }).eq('id', id);
                    mostrarNotificacao('Lançamento excluído', 'sucesso');
                    await recarregarDados();
                    atualizarUI();
                    await carregarRevisaoPluggy();
                } catch (e) {
                    console.error(e);
                    mostrarNotificacao('Erro ao excluir', 'erro');
                }
            } }
        ]
    });
}

function _renderRevisaoPluggyPreservandoScroll() {
    const y = window.scrollY;
    carregarRevisaoPluggy();
    window.scrollTo(0, y);
}

/** Linha do grupo "Já ignoradas" (status 'ignorada' no banco, de uma
 *  revisão anterior) — sempre riscada/travada, sem edição; o ↺ reativa
 *  direto no banco (ver reativarIgnoradaDbPluggy). */
function gerarHTMLIgnoradaDbPluggy(item) {
    const categoriaTxt = item.categoria_sugerida || item.categoria_pluggy || '';
    return htmlLinhaRevisao({
        atributos: `data-importada-id="${item.id}"`,
        ignorada: true,
        celulaAcao: `<button type="button" class="import-x" data-reativar-db="${item.id}" title="Reativar — volta pra 'Para revisar'" aria-label="Reativar">↺</button>`,
        dataISO: item.data, valor: item.valor,
        celulasMeio: `<td>${escAttrRevisao(categoriaTxt)}</td>`,
        descricao: item.descricao_banco || '',
    });
}

/** Manda uma linha "já ignorada" de volta pra fila (status -> 'pendente').
 *  Bate no banco na hora (diferente do X normal, que só sai da tela e some
 *  de verdade quando aperta "Importar"). */
async function reativarIgnoradaDbPluggy(id) {
    const { error } = await sb.from('transacoes_importadas').update({ status: 'pendente' }).eq('id', id);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao reativar', 'erro');
        return;
    }
    mostrarNotificacao('↺ De volta pra revisar', 'sucesso');
    carregarRevisaoPluggy();
}

function onRevisaoPluggyClick(e) {
    const reativarDb = e.target.closest('[data-reativar-db]');
    if (reativarDb) { reativarIgnoradaDbPluggy(Number(reativarDb.dataset.reativarDb)); return; }
    const x = e.target.closest('[data-rev-x]');
    if (x) { alternarIgnorarImportadaPluggy(Number(x.dataset.revX)); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    switch (btn.dataset.act) {
        case 'add-categoria': abrirNovaCategoria(btn.dataset.tipo); break;
        case 'editar-historico': editarHistoricoPluggy(id); break;
        case 'excluir-historico': excluirHistoricoPluggy(id); break;
    }
}

function onRevisaoPluggyChange(e) {
    const linha = e.target.closest('[data-importada-id]');
    if (!linha) return;
    const id = Number(linha.dataset.importadaId);
    if (e.target.dataset.campo === 'categoria') {
        _categoriaEscolhidaPluggy[id] = e.target.value || '';
        _renderRevisaoPluggyPreservandoScroll();
    } else if (e.target.dataset.campo === 'descricao') {
        // Só guarda — sem re-render (senão o campo perde o foco/cursor).
        _descricaoEditadaPluggy[id] = e.target.value;
    }
}

/** Grava de vez todas as "Prontas" (via adicionarTransacaoAPI, uma de cada
 *  vez, igual CSV/PDF) e marca cada uma como confirmada na fila. */
async function importarProntasPluggy() {
    const prontas = Object.values(_revisaoPluggyCache)
        .filter(item => _categoriaAoVivoPluggy(item) && !_ignoradasPluggy.has(item.id));
    const idsIgnoradas = [..._ignoradasPluggy];
    if (!prontas.length && !idsIgnoradas.length) return;

    const btn = document.getElementById('btnImportarProntasPluggy');
    const barra = document.getElementById('pluggyImportProgresso');
    if (btn) btn.disabled = true;
    if (barra) { barra.hidden = false; }

    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    let ok = 0, falhas = 0, parcelasN = 0;
    for (let i = 0; i < prontas.length; i++) {
        const item = prontas[i];
        if (barra) barra.textContent = `Importando ${i + 1} de ${prontas.length}...`;
        try {
            const metodoObj = item.metodo_sugerido ? metodos.find(m => m.id === item.metodo_sugerido) : null;
            // Crédito: competência vem da data da compra + fechamento do cartão
            // (mesma regra do formulário manual); os demais casos usam o mês
            // da própria data (competenciaDe sem diaFechamento não rola o mês).
            // Se a Pluggy ligou a compra a uma fatura, vale o mês dessa fatura.
            const competencia = item.competencia_fatura
                ? String(item.competencia_fatura).slice(0, 10)
                : competenciaDe(item.data, metodoObj && metodoObj.metodoKind === 'Crédito' ? metodoObj.diaFechamento : null);
            const ehParcela = item.parcelas_total > 1 && item.parcela_num >= 1 && item.tipo === 'saidas';
            if (ehParcela) parcelasN++;
            const adicionar = ehParcela ? dados => _adicionarParcelaPluggyAPI(dados, item) : adicionarTransacaoAPI;
            const nova = await adicionar({
                tipo: item.tipo,
                data: item.data,
                valor: item.valor,
                metodo: metodoObj ? rotuloMetodo(metodoObj) : null,
                categoria: _categoriaAoVivoPluggy(item),
                descricao: _descricaoAoVivoPluggy(item),
                formaPagamento: 'À vista',
                tipoRecorrencia: 'Pontual',
                competencia,
                origem: 'pluggy',
                // Snapshot de como a Pluggy mandou, antes de qualquer ajuste
                // feito aqui na revisão (categoria/descrição escolhidas acima
                // podem já ser diferentes do que veio sugerido).
                dadosOriginais: {
                    pluggy_transaction_id: item.pluggy_transaction_id,
                    data: item.data,
                    valor: item.valor,
                    tipo: item.tipo,
                    descricao_banco: item.descricao_banco,
                    categoria_pluggy: item.categoria_pluggy,
                    categoria_sugerida: item.categoria_sugerida,
                },
            });
            const { error } = await sb.from('transacoes_importadas').update({ status: 'confirmada', transacao_id: nova.id }).eq('id', item.id);
            if (error) throw error;
            delete _categoriaEscolhidaPluggy[item.id];
            delete _descricaoEditadaPluggy[item.id];
            ok++;
        } catch (err) {
            console.error('Erro ao importar lançamento Pluggy', item, err);
            falhas++;
        }
    }

    // Só agora as linhas marcadas com "X" saem da fila de verdade. As que têm um
    // lançamento correspondente (duplicata reconhecida) são CONCILIADAS: a linha
    // do banco fica ligada a ele (status 'confirmada'), em vez de só descartada.
    let conciliadasN = 0;
    if (idsIgnoradas.length) {
        const conciliar = idsIgnoradas.filter(id => _revisaoPluggyCache[id] && _revisaoPluggyCache[id]._candidatoId);
        const descartar = idsIgnoradas.filter(id => !conciliar.includes(id));
        for (const id of conciliar) {
            const { error } = await sb.from('transacoes_importadas')
                .update({ status: 'confirmada', transacao_id: _revisaoPluggyCache[id]._candidatoId }).eq('id', id);
            if (error) { console.error(error); falhas++; } else conciliadasN++;
        }
        if (descartar.length) {
            const { error } = await sb.from('transacoes_importadas').update({ status: 'ignorada' }).in('id', descartar);
            if (error) { console.error(error); falhas++; }
        }
        if (!falhas) idsIgnoradas.forEach(id => { _ignoradasPluggy.delete(id); delete _categoriaEscolhidaPluggy[id]; });
    }

    if (barra) barra.hidden = true;
    const descartadasN = idsIgnoradas.length - conciliadasN;
    const descartadas = !falhas
        ? (conciliadasN ? ` · ${conciliadasN} conciliado${conciliadasN === 1 ? '' : 's'} 🏦` : '') + (descartadasN > 0 ? ` · ${descartadasN} descartado${descartadasN === 1 ? '' : 's'}` : '')
        : '';
    mostrarNotificacao(
        falhas ? `${ok} importado(s), ${falhas} com erro` : `${ok} lançamento${ok === 1 ? '' : 's'} importado${ok === 1 ? '' : 's'}${parcelasN ? ` (${parcelasN} como parcela${parcelasN === 1 ? '' : 's'} de parcelamento)` : ''}${descartadas}`,
        falhas ? 'erro' : 'sucesso'
    );
    await carregarConciliadas();
    await carregarRevisaoPluggy();
    if (typeof recarregarDados === 'function') await recarregarDados();
    if (typeof atualizarUI === 'function') atualizarUI();
}

/** "Cancelar": desfaz as categorias escolhidas ainda não importadas —
 *  volta tudo pra "Pendentes para revisar"/"Duplicatas", sem mexer no banco. */
async function cancelarProntasPluggy() {
    for (const key of Object.keys(_categoriaEscolhidaPluggy)) delete _categoriaEscolhidaPluggy[key];
    for (const key of Object.keys(_descricaoEditadaPluggy)) delete _descricaoEditadaPluggy[key];
    // Os X's marcados nesta sessão já bateram no banco (ver
    // alternarIgnorarImportadaPluggy) — "Cancelar" precisa desfazer essa
    // escrita também, não só a marca local, senão a linha ficava presa em
    // "Já ignoradas" mesmo depois de cancelar.
    const idsParaReativar = [..._ignoradasPluggy];
    _ignoradasPluggy.clear();
    _duplicatasIniciadasPluggy.clear(); // carregarRevisao re-marca as duplicatas com X
    if (idsParaReativar.length) {
        const { error } = await sb.from('transacoes_importadas').update({ status: 'pendente' }).in('id', idsParaReativar);
        if (error) console.error('Erro ao desfazer X do Pluggy:', error);
    }
    carregarRevisaoPluggy();
}

/** "X": marca/desmarca a linha como "não importar" — a linha fica na tela
 *  (esmaecida e travada), igual sempre foi, MAS agora bate no banco na
 *  hora (status: 'ignorada'/'pendente'), não só localmente. Antes, um X
 *  que o usuário nunca "importava" (não clicava em Importar antes de sair
 *  da tela) se perdia ao recarregar a página — a transação voltava a
 *  aparecer como se fosse nova. Persistir na hora corrige isso: mesmo sem
 *  Importar, ela passa a aparecer em "Já ignoradas" (riscada) da próxima
 *  vez, nunca mais como nova. "Cancelar" desfaz essas escritas (ver
 *  cancelarProntasPluggy). */
async function alternarIgnorarImportadaPluggy(id) {
    const ligar = !_ignoradasPluggy.has(id);
    if (ligar) _ignoradasPluggy.add(id);
    else _ignoradasPluggy.delete(id);
    _renderRevisaoPluggyPreservandoScroll();
    const { error } = await sb.from('transacoes_importadas').update({ status: ligar ? 'ignorada' : 'pendente' }).eq('id', id);
    if (error) console.error('Erro ao persistir X do Pluggy:', error);
}

/** Chamado ao entrar na sub-aba "Pluggy" de Importar (ver menus-ui.js). */
function iniciarPluggy() {
    document.getElementById('btnConectarPluggy')?.addEventListener('click', conectarContaPluggy);
    document.getElementById('btnSincronizarPluggy')?.addEventListener('click', sincronizarPluggyAgora);
    const btnLimpar = document.getElementById('btnLimparRevisaoPluggy');
    if (btnLimpar) btnLimpar.addEventListener('click', onClickLimparRevisaoPluggy);
    document.querySelector('.pluggy-rendimentos')?.addEventListener('click', onClickRendimentosPluggy);
    _preencherSeletorSyncPluggy();
    document.getElementById('syncMesPluggy')?.addEventListener('change', onChangeSyncMesPluggy);
    document.getElementById('syncAnoMenos')?.addEventListener('click', () => onClickSyncAnoPluggy(-1));
    document.getElementById('syncAnoMais')?.addEventListener('click', () => onClickSyncAnoPluggy(1));
    document.getElementById('pluggyTelegramBox')?.addEventListener('click', onClickTelegramBox);
    carregarContasConectadas();
    carregarTelegramStatus();
    carregarRevisaoPluggy();
}

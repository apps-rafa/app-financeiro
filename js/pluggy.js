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
// (ex.: depois de (des)conectar uma conta). "Conectadas" começa aberto,
// "Desconectadas" começa fechado.
const _abertosPluggyContas = { conectadas: true, desconectadas: false };

/** Título de exibição de uma conta Pluggy — nunca o nome do conector (ex.:
 *  "MeuPluggy" agrega várias instituições reais e não diz nada sozinho). */
function tituloContaPluggy(c) {
    if (c.marketing_name) return c.marketing_name;
    if (c.tipo_conta === 'CREDIT') return 'Cartão de crédito';
    return c.nome_conta || 'Conta bancária';
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
        return;
    }

    const conectadas = data.filter(c => c.status !== 'desconectado');
    const desconectadas = data.filter(c => c.status === 'desconectado');

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

    const detalhesConta = [
        c.nome_conta,
        c.numero_mascarado ? `final ${c.numero_mascarado}` : null,
        c.marca_cartao,
    ].filter(Boolean).join(' · ');
    const saldoTxt = c.tipo_conta === 'BANK' && typeof c.saldo === 'number'
        ? `saldo: ${formatarMoeda(c.saldo)}` : '';

    return `
    <div class="menu-item ativo" data-conta-id="${c.id}">
        <div class="item-info">
            <div class="item-nome">${tituloContaPluggy(c)}
                ${c.banco_origem && c.banco_origem !== tituloContaPluggy(c)
                    ? `<span class="chip chip--neutro">${c.banco_origem}</span>` : ''}
                ${statusTag}
            </div>
            ${detalhesConta ? `<div class="item-descricao">${detalhesConta}</div>` : ''}
            <div class="item-descricao">${ultimoSync}${saldoTxt ? ' · ' + saldoTxt : ''}</div>
            <div class="item-descricao campo-metodo-conta">
                <label for="metodo-conta-${c.id}">Método do app:</label>
                <div class="campo-com-add campo-com-add--mini">
                    <select id="metodo-conta-${c.id}" data-act="metodo-conta" data-id="${c.id}">
                        <option value="">Selecione...</option>
                        ${opcoesMetodo}
                    </select>
                    <button type="button" class="btn-mini-add" data-act="add-metodo" title="Novo método">+</button>
                </div>
            </div>
            ${!desconectada ? `
            <div class="item-descricao">
                <button type="button" class="pluggy-toggle-opt ${c.sincronizar ? 'active' : ''}"
                    data-act="sincronizar-conta" data-id="${c.id}" data-sincronizar="${c.sincronizar ? '1' : '0'}">
                    Incluir na sincronização
                </button>
            </div>` : ''}
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
    const btnSync = e.target.closest('[data-act="sincronizar-conta"]');
    if (btnSync) {
        const ligar = btnSync.dataset.sincronizar !== '1';
        btnSync.classList.toggle('active', ligar);
        btnSync.dataset.sincronizar = ligar ? '1' : '0';
        associarSincronizarConta(Number(btnSync.dataset.id), ligar);
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

    const { data, error } = await sb.from('telegram_users').select('criado_em').maybeSingle();
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty-text">Erro ao verificar o Telegram</p>';
        return;
    }

    if (data) {
        box.innerHTML = `
            <p class="item-descricao">✅ Vinculado ao Telegram desde ${new Date(data.criado_em).toLocaleDateString('pt-BR')}</p>
            <button type="button" class="mini-btn" id="btnDesvincularTelegram">Desvincular</button>`;
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
                <button type="button" class="mini-btn" id="btnJaVincleiTelegram">Já vinculei, atualizar</button>
                <button type="button" class="mini-btn" id="btnConectarTelegram">🔁 Gerar outro código</button>
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
// Estado aberto/fechado dos grupos — sobrevive a re-renders.
const _abertosPluggy = { duplicatas: true, pendentes: true, prontas: true, historico: false };

/** Toggle "Rendimentos": Agrupar/Ignorar, um ativo por vez (não checkbox). */
function _modoRendimentosPluggy() {
    return document.querySelector('.pluggy-toggle-opt.active')?.dataset.rendimentos || 'agrupar';
}

function onClickRendimentosPluggy(e) {
    const btn = e.target.closest('.pluggy-toggle-opt');
    if (!btn) return;
    document.querySelectorAll('.pluggy-toggle-opt').forEach(b => b.classList.toggle('active', b === btn));
}

/** Só dígitos no campo "Buscar últimos N" (máx. 3 caracteres, já garantido
 *  pelo maxlength) — cola de texto ou teclas não-numéricas são limpas na
 *  hora, sem esperar o usuário confirmar. */
function onInputQtdPluggy(e) {
    e.target.value = e.target.value.replace(/\D/g, '');
}

function calcularDateFromSyncPluggy() {
    const qtd = parseInt(document.getElementById('syncQtdPluggy')?.value, 10);
    if (!qtd || qtd <= 0) return null;

    const alvo = new Date();
    alvo.setDate(alvo.getDate() - qtd);
    return alvo.toISOString().slice(0, 10);
}

/** Botão "Sincronizar agora": busca transações novas em todas as contas. */
async function sincronizarPluggyAgora() {
    const btn = document.getElementById('btnSincronizarPluggy');
    const textoOriginal = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando...'; }
    try {
        const dateFrom = calcularDateFromSyncPluggy();
        const body = { modoRendimentos: _modoRendimentosPluggy() };
        if (dateFrom) body.dateFrom = dateFrom;
        const { data, error } = await sb.functions.invoke('pluggy-sync', { body });
        if (error) throw error;
        const novas = data?.novas || 0;
        mostrarNotificacao(
            novas ? `${novas} transação(ões) nova(s) pra revisar` : 'Nada novo por enquanto',
            'sucesso'
        );
        await carregarRevisaoPluggy();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao sincronizar com a Pluggy', 'erro');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = textoOriginal || '↻ Sincronizar agora'; }
    }
}

/** Botão "Limpar tudo": mesmo padrão de 2 cliques usado no resto do app
 *  (sem confirm() nativo) — apaga de vez as linhas 'pendente' e 'ignorada'.
 *  Preserva as 'confirmada' (já viraram lançamento de verdade). */
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

async function limparFilaRevisaoPluggy(btn) {
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    const original = '🧹 Limpar tudo';
    btn.disabled = true;
    try {
        const { error } = await sb.from('transacoes_importadas').delete().in('status', ['pendente', 'ignorada']);
        if (error) throw error;
        mostrarNotificacao('Fila de revisão limpa', 'sucesso');
        await carregarRevisaoPluggy();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao limpar a fila', 'erro');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

/** Marca cada item pendente como possível duplicata — mesmo tipo, mesmo
 *  valor (tolerância de 1 centavo) e data a até 2 dias de distância de
 *  algum lançamento que já existe no app (mesma ideia de _conciliar em
 *  js/conciliar-pdf.js) — mostrado num grupo à parte, igual CSV/PDF. */
function _marcarDuplicatasPluggy(itens) {
    const pool = [...(estadoApp.transacoes.entradas || []), ...(estadoApp.transacoes.saidas || [])];
    return itens.map(item => {
        const suspeita = pool.some(t =>
            t.tipo === item.tipo &&
            Math.abs(parseFloat(t.valor) - parseFloat(item.valor)) < 0.005 &&
            typeof _diffDias === 'function' && _diffDias(t.data, item.data) <= 2
        );
        return { ...item, _duplicataSuspeita: suspeita };
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

    const [{ data, error }, { data: historico }] = await Promise.all([
        sb.from('transacoes_importadas').select('*').eq('status', 'pendente').order('data', { ascending: false }),
        // Junta com a transação de verdade — categoria/descrição podem ter
        // sido ajustadas na revisão antes de importar, diferentes do que a
        // Pluggy sugeriu originalmente (categoria_sugerida fica "congelada").
        sb.from('transacoes_importadas')
            .select('*, transacao:transacao_id(id, data, valor, tipo, categoria, descricao, metodo, competencia)')
            .eq('status', 'confirmada').order('criado_em', { ascending: false }).limit(20),
    ]);

    if (error) {
        console.error(error);
        container.innerHTML = '<p class="empty-message">Erro ao carregar a fila de revisão</p>';
        return;
    }

    const pendentesBrutos = data || [];
    const marcados = _marcarDuplicatasPluggy(pendentesBrutos);
    _revisaoPluggyCache = Object.fromEntries(marcados.map(item => [item.id, item]));
    _historicoPluggyCache = Object.fromEntries((historico || []).map(item => [item.id, item]));

    const temCategoria = item => !!_categoriaAoVivoPluggy(item);
    const duplicatas = marcados.filter(i => i._duplicataSuspeita && !temCategoria(i));
    const pendentes = marcados.filter(i => !i._duplicataSuspeita && !temCategoria(i));
    const prontas = marcados.filter(temCategoria);

    if (!pendentesBrutos.length && !(historico || []).length) {
        container.innerHTML = '<p class="empty-message">Nada pendente — toque em "Sincronizar agora" pra buscar transações novas</p>';
        container.onclick = null;
        container.onchange = null;
        return;
    }

    // Mesma tabela do CSV/PDF (import-csv-tabela) — colunas Data/Valor/Tipo/
    // Categoria/Descrição, sem "Forma de pgto." (o método já vem fixado
    // pela conta em "Método do app", não faz sentido escolher de novo aqui).
    const tabela = (id, titulo, lista, aberto, comIgnorar = true) => !lista.length ? '' : _grupoColapsavelConciliar({
        id, abertos: _abertosPluggy, padraoAberto: aberto, titulo: `${titulo} (${lista.length})`,
        corpo: `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr>
                ${comIgnorar ? '<th>Ignorar?</th>' : ''}
                <th>Data</th><th>Valor</th><th>Tipo</th><th>Categoria</th><th>Descrição</th>
            </tr></thead>
            <tbody>${lista.map(item => gerarHTMLImportadaPluggy(item, comIgnorar)).join('')}</tbody>
        </table>
    </div>`
    });

    const tabelaHistorico = !( historico || []).length ? '' : _grupoColapsavelConciliar({
        id: 'pluggy-historico', abertos: _abertosPluggy, padraoAberto: false,
        titulo: `📜 Já lançados (histórico) (${historico.length})`,
        corpo: `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr><th>Data</th><th>Valor</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th></th></tr></thead>
            <tbody>${historico.map(gerarHTMLHistoricoPluggy).join('')}</tbody>
        </table>
    </div>`
    });

    container.innerHTML = [
        `<p class="import-csv-resumo">
            ${pendentesBrutos.length ? `<b>${pendentesBrutos.length}</b> pendente${pendentesBrutos.length === 1 ? '' : 's'} —` : ''}
            <span class="ok">${prontas.length} pronta${prontas.length === 1 ? '' : 's'}</span>
            ${duplicatas.length ? ` · <span class="alerta">${duplicatas.length} possível${duplicatas.length === 1 ? '' : 'is'} duplicata${duplicatas.length === 1 ? '' : 's'}</span>` : ''}
            ${pendentes.length ? ` · <span class="alerta">${pendentes.length} pra revisar</span>` : ''}
        </p>`,
        duplicatas.length
            ? `<p class="import-csv-nota">🔁 Mesmo tipo, data (± 2 dias) e valor de algo já lançado no app — escolha uma categoria pra liberar, ou ignore pra não duplicar.</p>`
            : '',
        tabela('pluggy-duplicatas', '🔁 Possíveis duplicatas', duplicatas, _abertosPluggy.duplicatas),
        tabela('pluggy-pendentes', '⚠️ Pendentes para revisar', pendentes, _abertosPluggy.pendentes),
        tabela('pluggy-prontas', '✓ Prontas', prontas, _abertosPluggy.prontas, false),
        `<div class="import-csv-acoes">
            <button type="button" class="btn-submit" id="btnImportarProntasPluggy" ${prontas.length ? '' : 'disabled'}>
                Importar ${prontas.length} lançamento${prontas.length === 1 ? '' : 's'}
            </button>
            <button type="button" class="mini-btn" id="btnCancelarProntasPluggy" ${prontas.length ? '' : 'disabled'}>Cancelar</button>
        </div>
        <div id="pluggyImportProgresso" class="import-csv-progresso" hidden></div>`,
        tabelaHistorico,
    ].join('');

    container.querySelectorAll('details.import-csv-grupo').forEach(det => {
        det.addEventListener('toggle', () => {
            const chave = { 'pluggy-duplicatas': 'duplicatas', 'pluggy-pendentes': 'pendentes', 'pluggy-prontas': 'prontas', 'pluggy-historico': 'historico' }[det.dataset.grupoId];
            if (chave) _abertosPluggy[chave] = det.open;
        });
    });

    document.getElementById('btnImportarProntasPluggy')?.addEventListener('click', importarProntasPluggy);
    document.getElementById('btnCancelarProntasPluggy')?.addEventListener('click', cancelarProntasPluggy);

    container.onclick = onRevisaoPluggyClick;
    container.onchange = onRevisaoPluggyChange;
}

/** Linha da tabela de revisão: categoria (ajustável — escolher move pra
 *  "Prontas" na hora) + descrição + checkbox pra ignorar. Sem coluna de
 *  forma de pagamento: esse já vem fixado pela conta em "Método do app"
 *  (ver carregarContasConectadas). Mesmo layout de tabela do CSV/PDF. */
function gerarHTMLImportadaPluggy(item, comIgnorar = true) {
    const dataFmt = item.data ? item.data.split('-').reverse().join('/') : '?';
    const sinal = item.tipo === 'entradas' ? '+' : '-';
    const descEscapada = _descricaoAoVivoPluggy(item).replace(/"/g, '&quot;');

    const categoriasApp = (estadoApp.menus &&
        (item.tipo === 'entradas' ? estadoApp.menus.categoriasReceita : estadoApp.menus.categoriasDespesa)) || [];
    const categoriaAoVivo = _categoriaAoVivoPluggy(item);
    const opcoesCategoria = categoriasApp.map(nome =>
        `<option value="${nome}" ${nome === categoriaAoVivo ? 'selected' : ''}>${nome}</option>`
    ).join('');

    return `
    <tr data-importada-id="${item.id}">
        ${comIgnorar ? `<td><input type="checkbox" data-act="ignorar-importada" data-id="${item.id}" title="Não importar esta linha"></td>` : ''}
        <td>${dataFmt}</td>
        <td>${sinal} ${formatarMoeda(item.valor)}</td>
        <td><span class="chip-tipo chip-tipo--${item.tipo}">${item.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
        <td>
            <select data-campo="categoria" title="Categoria">
                <option value="">Selecione...</option>
                ${opcoesCategoria}
            </select>
        </td>
        <td class="import-csv-desc" title="${descEscapada}">${descEscapada}</td>
    </tr>`;
}

/** Linha do histórico (já confirmado) — categoria/descrição/data vêm da
 *  transação de verdade (transacao_id), não da sugestão original da
 *  Pluggy, que pode ter sido trocada na revisão antes de importar. Dá pra
 *  editar/excluir o lançamento direto daqui. */
function gerarHTMLHistoricoPluggy(item) {
    const t = item.transacao;
    if (!t) {
        // Lançamento apagado depois de importado — a linha da fila continua
        // só pra registro; sem transação de verdade não tem o que mostrar.
        return `<tr><td colspan="6">Lançamento apagado — ${item.descricao_banco || 'sem descrição'}</td></tr>`;
    }
    const dataFmt = t.data ? t.data.split('-').reverse().join('/') : '?';
    const sinal = t.tipo === 'entradas' ? '+' : '-';
    return `
    <tr data-historico-id="${item.id}">
        <td>${dataFmt}</td>
        <td>${sinal} ${formatarMoeda(t.valor)}</td>
        <td><span class="chip-tipo chip-tipo--${t.tipo}">${t.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
        <td>${t.categoria || 'Sem categoria'}</td>
        <td class="import-csv-desc" title="${t.descricao || ''}">${t.descricao || ''}</td>
        <td>
            <button class="btn-icon" data-act="editar-historico" data-id="${item.id}" title="Editar">✏️</button>
            <button class="btn-icon btn-danger" data-act="excluir-historico" data-id="${item.id}" title="Excluir">🗑️</button>
        </td>
    </tr>`;
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

function onRevisaoPluggyClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    switch (btn.dataset.act) {
        case 'add-categoria': abrirNovaCategoria(btn.dataset.tipo); break;
        case 'ignorar-importada': ignorarImportadaPluggy(id); break;
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
    }
}

/** Grava de vez todas as "Prontas" (via adicionarTransacaoAPI, uma de cada
 *  vez, igual CSV/PDF) e marca cada uma como confirmada na fila. */
async function importarProntasPluggy() {
    const prontas = Object.values(_revisaoPluggyCache).filter(item => _categoriaAoVivoPluggy(item));
    if (!prontas.length) return;

    const btn = document.getElementById('btnImportarProntasPluggy');
    const barra = document.getElementById('pluggyImportProgresso');
    if (btn) btn.disabled = true;
    if (barra) { barra.hidden = false; }

    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    let ok = 0, falhas = 0;
    for (let i = 0; i < prontas.length; i++) {
        const item = prontas[i];
        if (barra) barra.textContent = `Importando ${i + 1} de ${prontas.length}...`;
        try {
            const metodoObj = item.metodo_sugerido ? metodos.find(m => m.id === item.metodo_sugerido) : null;
            // Crédito: competência vem da data da compra + fechamento do cartão
            // (mesma regra do formulário manual); os demais casos usam o mês
            // da própria data (competenciaDe sem diaFechamento não rola o mês).
            const competencia = competenciaDe(item.data, metodoObj && metodoObj.metodoKind === 'Crédito' ? metodoObj.diaFechamento : null);
            const nova = await adicionarTransacaoAPI({
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

    if (barra) barra.hidden = true;
    mostrarNotificacao(
        falhas ? `${ok} importado(s), ${falhas} com erro` : `${ok} lançamento${ok === 1 ? '' : 's'} importado${ok === 1 ? '' : 's'}`,
        falhas ? 'erro' : 'sucesso'
    );
    await carregarRevisaoPluggy();
    if (typeof recarregarDados === 'function') await recarregarDados();
    if (typeof atualizarUI === 'function') atualizarUI();
}

/** "Cancelar": desfaz as categorias escolhidas ainda não importadas —
 *  volta tudo pra "Pendentes para revisar"/"Duplicatas", sem mexer no banco. */
function cancelarProntasPluggy() {
    for (const key of Object.keys(_categoriaEscolhidaPluggy)) delete _categoriaEscolhidaPluggy[key];
    for (const key of Object.keys(_descricaoEditadaPluggy)) delete _descricaoEditadaPluggy[key];
    carregarRevisaoPluggy();
}

/** Ignora uma importada: não vira lançamento, só sai da fila. */
async function ignorarImportadaPluggy(id) {
    const { error } = await sb.from('transacoes_importadas').update({ status: 'ignorada' }).eq('id', id);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao ignorar', 'erro');
        return;
    }
    delete _categoriaEscolhidaPluggy[id];
    delete _descricaoEditadaPluggy[id];
    mostrarNotificacao('Ignorado', 'sucesso');
    await carregarRevisaoPluggy();
}

/** Chamado ao entrar na sub-aba "Pluggy" de Importar (ver menus-ui.js). */
function iniciarPluggy() {
    document.getElementById('btnConectarPluggy')?.addEventListener('click', conectarContaPluggy);
    document.getElementById('btnSincronizarPluggy')?.addEventListener('click', sincronizarPluggyAgora);
    const btnLimpar = document.getElementById('btnLimparRevisaoPluggy');
    if (btnLimpar) btnLimpar.addEventListener('click', onClickLimparRevisaoPluggy);
    document.querySelector('.pluggy-rendimentos')?.addEventListener('click', onClickRendimentosPluggy);
    document.getElementById('syncQtdPluggy')?.addEventListener('input', onInputQtdPluggy);
    document.getElementById('pluggyTelegramBox')?.addEventListener('click', onClickTelegramBox);
    carregarContasConectadas();
    carregarTelegramStatus();
    carregarRevisaoPluggy();
}

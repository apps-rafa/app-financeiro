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
 * FILA DE REVISÃO — transações vindas do banco, aguardando confirmação.
 * Confirmar grava um lançamento de verdade (via adicionarTransacaoAPI);
 * ignorar só marca a linha, sem apagar nada.
 */

let _revisaoPluggyCache = {};
// Estado aberto/fechado dos 2 grupos (duplicatas/pendentes) — sobrevive a
// re-renders (ex.: depois de confirmar uma linha) igual ao resto do app.
const _abertosPluggy = { duplicatas: true, pendentes: true };

/** Toggle "Rendimentos": Agrupar/Ignorar, um ativo por vez (não checkbox). */
function _modoRendimentosPluggy() {
    return document.querySelector('.pluggy-toggle-opt.active')?.dataset.rendimentos || 'agrupar';
}

function onClickRendimentosPluggy(e) {
    const btn = e.target.closest('.pluggy-toggle-opt');
    if (!btn) return;
    document.querySelectorAll('.pluggy-toggle-opt').forEach(b => b.classList.toggle('active', b === btn));
}

/** Setas ▲▼ do campo "Buscar últimos N" — nativas do <input type=number>
 *  ficavam ilegíveis (some em claro, some em escuro). */
function onClickStepperPluggy(e) {
    const btn = e.target.closest('.pluggy-stepper-btn');
    if (!btn) return;
    const input = btn.closest('.pluggy-stepper')?.querySelector('input');
    if (!input) return;
    const min = parseInt(input.min, 10) || 1;
    const atual = parseInt(input.value, 10) || min;
    input.value = Math.max(min, atual + Number(btn.dataset.step));
}

function calcularDateFromSyncPluggy() {
    const qtdEl = document.getElementById('syncQtdPluggy');
    const unidadeEl = document.getElementById('syncUnidadePluggy');
    const qtd = parseInt(qtdEl?.value, 10);
    if (!qtd || qtd <= 0) return null;

    const alvo = new Date();
    if (unidadeEl?.value === 'meses') alvo.setMonth(alvo.getMonth() - qtd);
    else if (unidadeEl?.value === 'anos') alvo.setFullYear(alvo.getFullYear() - qtd);
    else alvo.setDate(alvo.getDate() - qtd);
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

/** Carrega e renderiza a fila de revisão (Importar > Pluggy). */
async function carregarRevisaoPluggy() {
    const container = document.getElementById('pluggyRevisaoLista');
    if (!container) return;

    const { data, error } = await sb
        .from('transacoes_importadas')
        .select('*, conta:conta_id(nome_instituicao, tipo_conta, nome_conta, marketing_name, banco_origem, metodo_id)')
        .eq('status', 'pendente')
        .order('data', { ascending: false });

    if (error) {
        console.error(error);
        container.innerHTML = '<p class="empty-message">Erro ao carregar a fila de revisão</p>';
        return;
    }
    if (!data || !data.length) {
        _revisaoPluggyCache = {};
        container.innerHTML = '<p class="empty-message">Nada pendente — toque em "Sincronizar agora" pra buscar transações novas</p>';
        container.onclick = null;
        return;
    }

    const marcados = _marcarDuplicatasPluggy(data);
    _revisaoPluggyCache = Object.fromEntries(marcados.map(item => [item.id, item]));
    const duplicatas = marcados.filter(i => i._duplicataSuspeita);
    const pendentes = marcados.filter(i => !i._duplicataSuspeita);

    const grupo = (id, titulo, lista, aberto) => !lista.length ? '' : `
        <details class="import-csv-grupo" data-grupo-id="${id}" ${aberto ? 'open' : ''}>
          <summary class="import-csv-grupo-titulo">${titulo} (${lista.length})</summary>
          ${lista.map(gerarHTMLImportadaPluggy).join('')}
        </details>`;

    container.innerHTML = [
        duplicatas.length
            ? `<p class="import-csv-nota">🔁 Mesmo tipo, data (± 2 dias) e valor de algo já lançado no app — confira antes de confirmar pra não duplicar.</p>`
            : '',
        grupo('pluggy-duplicatas', '🔁 Possíveis duplicatas', duplicatas, _abertosPluggy.duplicatas),
        grupo('pluggy-pendentes', 'Pendentes para revisar', pendentes, _abertosPluggy.pendentes),
    ].join('');

    container.querySelectorAll('details.import-csv-grupo').forEach(det => {
        det.addEventListener('toggle', () => {
            const chave = det.dataset.grupoId === 'pluggy-duplicatas' ? 'duplicatas' : 'pendentes';
            _abertosPluggy[chave] = det.open;
        });
    });

    container.onclick = onRevisaoPluggyClick;
}

/** Card de uma transação importada: dados da Pluggy + categoria/método
 *  ajustáveis antes de confirmar. */
function gerarHTMLImportadaPluggy(item) {
    const _dowTri = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const dt = item.data ? parseDataLocal(item.data) : null;
    const dia = dt ? String(dt.getDate()).padStart(2, '0') : '--';
    const dow = dt ? _dowTri[dt.getDay()] : '';
    const sinal = item.tipo === 'entradas' ? '+' : '-';

    const contaTag = item.conta
        ? `<span class="chip chip--neutro">${item.conta.banco_origem || tituloContaPluggy(item.conta)}</span>`
        : '';
    const descEscapada = (item.descricao_banco || '').replace(/"/g, '&quot;');
    const desc = `<input type="text" class="input-mini despesa-desc-input" data-campo="descricao"
        value="${descEscapada}" placeholder="Descrição" title="Descrição">`;

    const categoriasApp = (estadoApp.menus &&
        (item.tipo === 'entradas' ? estadoApp.menus.categoriasReceita : estadoApp.menus.categoriasDespesa)) || [];
    const categoriaPreSelecionada = item.categoria_sugerida || sugerirCategoriaClientePluggy(item, categoriasApp);
    const opcoesCategoria = categoriasApp.map(nome =>
        `<option value="${nome}" ${nome === categoriaPreSelecionada ? 'selected' : ''}>${nome}</option>`
    ).join('');

    const metodoPreSelecionado = item.metodo_sugerido ?? item.conta?.metodo_id ?? null;
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const opcoesMetodo = metodos.map(m =>
        `<option value="${m.id}" ${m.id === metodoPreSelecionado ? 'selected' : ''}>${rotuloMetodo(m)}</option>`
    ).join('');

    return `
        <div class="despesa-item ${item.tipo === 'entradas' ? 'entrada' : 'saida'}" data-importada-id="${item.id}">
            <span class="despesa-data"><span class="despesa-dia">${dia}</span><span class="despesa-dow">${dow}</span></span>
            <span class="despesa-valor">${sinal} ${formatarMoeda(item.valor)}</span>
            <div class="campo-com-add">
                <select class="select-mini" data-campo="categoria" title="Categoria">
                    <option value="">Categoria...</option>
                    ${opcoesCategoria}
                </select>
                <button type="button" class="btn-mini-add" data-act="add-categoria" data-tipo="${item.tipo}" title="Nova categoria">+</button>
            </div>
            <div class="campo-com-add">
                <select class="select-mini" data-campo="metodo" title="Método">
                    <option value="">Método...</option>
                    ${opcoesMetodo}
                </select>
                <button type="button" class="btn-mini-add" data-act="add-metodo" title="Novo método">+</button>
            </div>
            ${contaTag}
            ${desc}
            <div class="despesa-actions">
                <button class="btn-ok" data-act="confirmar-importada" data-id="${item.id}" title="Confirmar">✓</button>
                <button class="btn-icon btn-danger" data-act="ignorar-importada" data-id="${item.id}" title="Ignorar">✕</button>
            </div>
        </div>`;
}

function onRevisaoPluggyClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add-categoria') { abrirNovaCategoria(btn.dataset.tipo); return; }
    if (btn.dataset.act === 'add-metodo') { abrirNovoMetodo(); return; }
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'confirmar-importada') confirmarImportadaPluggy(id);
    else if (btn.dataset.act === 'ignorar-importada') ignorarImportadaPluggy(id);
}

/** Confirma uma importada: grava a transação de verdade e marca a fila. */
async function confirmarImportadaPluggy(id) {
    const item = _revisaoPluggyCache[id];
    const card = document.querySelector(`[data-importada-id="${id}"]`);
    if (!item || !card) return;

    const categoria = card.querySelector('select[data-campo="categoria"]')?.value || '';
    const metodoId = card.querySelector('select[data-campo="metodo"]')?.value;
    if (!categoria) {
        mostrarNotificacao('Escolhe uma categoria antes de confirmar', 'erro');
        return;
    }

    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const metodoObj = metodoId ? metodos.find(m => m.id === Number(metodoId)) : null;
    const metodoRotulo = metodoObj ? rotuloMetodo(metodoObj) : null;
    // Crédito: competência vem da data da compra + fechamento do cartão
    // (mesma regra do formulário manual); os demais casos usam o mês da
    // própria data (competenciaDe sem diaFechamento não rola o mês).
    const competencia = competenciaDe(
        item.data,
        metodoObj && metodoObj.metodoKind === 'Crédito' ? metodoObj.diaFechamento : null
    );

    const descricao = card.querySelector('input[data-campo="descricao"]')?.value.trim() || '';

    const dados = {
        tipo: item.tipo,
        data: item.data,
        valor: item.valor,
        metodo: metodoRotulo,
        categoria,
        descricao,
        formaPagamento: 'À vista',
        tipoRecorrencia: 'Pontual',
        competencia,
    };

    try {
        const nova = await adicionarTransacaoAPI(dados);
        const { error } = await sb
            .from('transacoes_importadas')
            .update({ status: 'confirmada', transacao_id: nova.id })
            .eq('id', id);
        if (error) throw error;
        mostrarNotificacao('Lançamento confirmado', 'sucesso');
        await carregarRevisaoPluggy();
        if (typeof recarregarDados === 'function') await recarregarDados();
        if (typeof atualizarUI === 'function') atualizarUI();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao confirmar — o lançamento pode já ter sido criado, confira antes de tentar de novo', 'erro');
    }
}

/** Ignora uma importada: não vira lançamento, só sai da fila. */
async function ignorarImportadaPluggy(id) {
    const { error } = await sb.from('transacoes_importadas').update({ status: 'ignorada' }).eq('id', id);
    if (error) {
        console.error(error);
        mostrarNotificacao('Erro ao ignorar', 'erro');
        return;
    }
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
    document.querySelector('.pluggy-sync-periodo')?.addEventListener('click', onClickStepperPluggy);
    carregarContasConectadas();
    carregarRevisaoPluggy();
}

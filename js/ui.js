/**
 * INTERFACE DO USUÁRIO
 * Renderização e atualização do DOM
 */

/**
 * Atualiza toda a interface
 */
function atualizarUI() {
    atualizarCalendarioNav();

    // Atualizar resumo
    atualizarResumo();

    // Atualizar listas
    atualizarEntradasLista();
    atualizarSaidasLista();

    // "Próximas" acompanha o mês em exibição
    if (document.getElementById('proximas')?.classList.contains('active')) {
        atualizarProximasTransacoes();
    }
}

// Índice (0-11) do mês no centro da janela de meses exibida. null = ainda
// não foi definido manualmente pelas setas laterais — usa o mês selecionado
// como centro.
let mesesJanelaCentro = null;

// Tamanhos possíveis da janela (sempre ímpar/simétrico: N pra trás, atual, N
// pra frente), da mais larga pra mais estreita.
const TAMANHOS_JANELA_MESES = [7, 5, 3, 1];

/**
 * (Re)desenha a tira de meses + o ano no calendário do topo, tudo numa
 * linha só. Sempre mostra uma janela simétrica (3 antes + atual + 3 depois,
 * no máximo) com setas laterais pra navegar os meses escondidos sem mudar a
 * seleção — a janela só encolhe (7 -> 5 -> 3 -> 1) até caber na largura
 * disponível. Não depende de dados carregados — seguro de chamar em
 * qualquer resize.
 */
function atualizarCalendarioNav() {
    const lista = document.getElementById('mesesLista');
    const setaEsq = document.getElementById('mesesSetaEsq');
    const setaDir = document.getElementById('mesesSetaDir');
    const anoLabel = document.getElementById('anoAtualLabel');
    if (!lista || typeof estadoApp === 'undefined' || !estadoApp.mesAtual) return;

    const hoje = new Date();
    const anoSelecionado = estadoApp.mesAtual.getFullYear();
    const mesSelecionado = estadoApp.mesAtual.getMonth();
    const ehAnoAtual = anoSelecionado === hoje.getFullYear();
    const mesHojeIdx = hoje.getMonth();
    const centro = mesesJanelaCentro != null ? mesesJanelaCentro : mesSelecionado;

    if (anoLabel) anoLabel.textContent = String(anoSelecionado);

    const montarBtn = idx => {
        const selecionado = idx === mesSelecionado;
        const ehHoje = ehAnoAtual && idx === mesHojeIdx;
        const classes = ['mes-btn', selecionado && 'selecionado', ehHoje && 'hoje'].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-mes="${idx}">${MESES_TRI[idx]}</button>`;
    };

    const idxsDaJanela = tamanho => {
        const k = (tamanho - 1) / 2;
        const idxs = [];
        for (let i = centro - k; i <= centro + k; i++) if (i >= 0 && i <= 11) idxs.push(i);
        return idxs;
    };

    const renderJanela = idxs => {
        lista.innerHTML = idxs.map(montarBtn).join('');
        if (setaEsq) setaEsq.disabled = idxs[0] <= 0;
        if (setaDir) setaDir.disabled = idxs[idxs.length - 1] >= 11;
    };

    renderJanela(idxsDaJanela(TAMANHOS_JANELA_MESES[0]));

    // Mede depois do layout: se estourou, encolhe a janela até caber.
    requestAnimationFrame(() => {
        for (let i = 1; i < TAMANHOS_JANELA_MESES.length && lista.scrollWidth > lista.clientWidth + 1; i++) {
            renderJanela(idxsDaJanela(TAMANHOS_JANELA_MESES[i]));
        }
    });
}

/**
 * Atualiza card de resumo
 */
function atualizarResumo() {
    const resumo = obterResumoFormatado();
    
    const totalEntradasEl = document.querySelector(SELECTORS.totalEntradas);
    const totalSaidasEl = document.querySelector(SELECTORS.totalSaidas);
    const balancoEl = document.querySelector(SELECTORS.balanco);
    
    if (totalEntradasEl) totalEntradasEl.textContent = resumo.entradas;
    if (totalSaidasEl) totalSaidasEl.textContent = resumo.saidas;

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = formatarMoeda(v || 0); };
    setTxt('entradasAtual', estadoApp.resumo.entradasAtual);
    setTxt('entradasAReceber', estadoApp.resumo.entradasAReceber);
    setTxt('saidasAtual', estadoApp.resumo.saidasAtual);
    setTxt('saidasAPagar', estadoApp.resumo.saidasAPagar);

    if (balancoEl) {
        balancoEl.textContent = resumo.balanco;
        // Balanço sempre com a cor "balanço" (amarelo) — sem tema por saldo.
        const card = balancoEl.closest('.summary-card');
        if (card) card.style.cssText = '';
    }

    // Gasto diário = balanço / dias restantes do mês vigente
    const gd = document.getElementById('gastoDiario');
    const gdSub = document.getElementById('gastoDiarioSub');
    const gastoDiarioValor = (estadoApp.resumo.balanco || 0) / diasRestantesMesVigente();
    if (gd) {
        const dias = diasRestantesMesVigente();
        gd.textContent = formatarMoeda(gastoDiarioValor);
        if (gdSub) gdSub.textContent = `${dias} dia${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}`;
    }

    // Espelha os totais no resumo compacto (barra fixa) — com "R$", sem centavos ",00"
    const setMini = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = formatarMoeda(v || 0); };
    setMini('miniEntradas', estadoApp.resumo.entradas);
    setMini('miniSaidas', estadoApp.resumo.saidas);
    setMini('miniBalanco', estadoApp.resumo.balanco);
    setMini('miniGasto', gastoDiarioValor);
}

/** Dias restantes do mês corrente, incluindo hoje (mínimo 1) */
function diasRestantesMesVigente() {
    const hoje = new Date();
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    return Math.max(1, ultimoDia - hoje.getDate() + 1);
}

/** Lê de localStorage o modo salvo pra essa lista, validando contra as opções atuais. */
function _modoListaSalvo(chave, validos) {
    try {
        const salvo = localStorage.getItem(chave);
        return validos.includes(salvo) ? salvo : 'recorrencia';
    } catch (_) { return 'recorrencia'; }
}

/** Escolhe a renderização certa pro modo de visualização selecionado — usado
 *  tanto por Receitas quanto por Despesas. */
function renderListaPorModo(container, transacoes, tipoUI, modo, msgVazia) {
    if (modo === 'metodo') {
        renderListaPorMetodo(container, transacoes, tipoUI, msgVazia);
    } else if (modo === 'categoria') {
        renderListaPorCategoria(container, transacoes, tipoUI, msgVazia);
    } else if (modo === 'cronologica') {
        renderListaCronologica(container, transacoes, tipoUI, msgVazia);
    } else {
        renderListaAgrupada(container, transacoes, tipoUI, msgVazia);
    }
}

// 'recorrencia' (padrão) | 'categoria' | 'cronologica' — visão da aba Receitas
const MODOS_LISTA_ENTRADAS = ['recorrencia', 'categoria', 'cronologica'];
let modoListaEntradas = _modoListaSalvo('modoListaEntradas', MODOS_LISTA_ENTRADAS);

function definirModoListaEntradas(modo) {
    modoListaEntradas = MODOS_LISTA_ENTRADAS.includes(modo) ? modo : 'recorrencia';
    try { localStorage.setItem('modoListaEntradas', modoListaEntradas); } catch (_) {}
    atualizarEntradasLista();
}

function atualizarEntradasLista() {
    document.querySelectorAll('#modoEntradas .modo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.modo === modoListaEntradas));
    renderListaPorModo(document.querySelector(SELECTORS.entradasLista),
        estadoApp.transacoes.entradas, 'entrada', modoListaEntradas, 'Nenhuma receita neste mês');
}

// 'recorrencia' (padrão) | 'metodo' | 'categoria' | 'cronologica' — visão da aba Despesas
const MODOS_LISTA_SAIDAS = ['recorrencia', 'metodo', 'categoria', 'cronologica'];
let modoListaSaidas = _modoListaSalvo('modoListaSaidas', MODOS_LISTA_SAIDAS);

function definirModoListaSaidas(modo) {
    modoListaSaidas = MODOS_LISTA_SAIDAS.includes(modo) ? modo : 'recorrencia';
    try { localStorage.setItem('modoListaSaidas', modoListaSaidas); } catch (_) {}
    atualizarSaidasLista();
}

function atualizarSaidasLista() {
    document.querySelectorAll('#modoSaidas .modo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.modo === modoListaSaidas));
    renderListaPorModo(document.querySelector(SELECTORS.saidasLista),
        estadoApp.transacoes.saidas, 'saida', modoListaSaidas, 'Nenhuma despesa neste mês');
}

/** Agrupa e renderiza `transacoes` por `chaveDe(t)`, ordenado por total (maior primeiro).
 *  Usado por "Por método" e "Por categoria" — mesmo formato de card recolhível. */
function _renderListaAgrupadaPorTotal(container, transacoes, tipoUI, msgVazia, { chaveDe, semChave, cores, gerarOpts }) {
    if (!container) return;
    if (!transacoes || !transacoes.length) {
        container.innerHTML = `<p class="empty-message">${msgVazia}</p>`;
        container.onclick = null;
        return;
    }
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;

    const mapa = new Map();
    transacoes.forEach(t => {
        const k = chaveDe(t) || semChave;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(t);
    });
    const grupos = [...mapa.entries()]
        .map(([nome, itens]) => [nome, itens.sort(_porDataDesc), itens.reduce((s, t) => s + valorDe(t), 0)])
        .sort((a, b) => b[2] - a[2]);

    const totalGeral = grupos.reduce((s, g) => s + g[2], 0);

    container.innerHTML = grupos.map(([nome, itens, total]) => {
        const c = cores[nome] || corPadraoChip(nome);
        const pct = totalGeral ? Math.round((total / totalGeral) * 100) : 0;
        return `
        <details class="rec-grupo" style="--cor-rec:${c}">
          <summary>
            <span class="rec-grupo-nome">${nome}</span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total">${formatarMoeda(total)}${totalGeral ? ` · ${pct}%` : ''}</span>
          </summary>
          <div class="rec-grupo-itens">
            ${itens.map(t => gerarHTMLTransacao(t, tipoUI, gerarOpts)).join('')}
          </div>
        </details>`;
    }).join('');

    container.onclick = onListaTransacaoClick;
}

/** Transações agrupadas por método de pagamento, ordenadas por total (maior primeiro) */
function renderListaPorMetodo(container, transacoes, tipoUI, msgVazia) {
    const cores = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.metodo) || {};
    _renderListaAgrupadaPorTotal(container, transacoes, tipoUI, msgVazia, {
        chaveDe: t => t.metodo,
        semChave: 'Sem método',
        cores,
        gerarOpts: { comRecorrenciaChip: true }
    });
}

/** Transações agrupadas por categoria, ordenadas por total (maior primeiro) */
function renderListaPorCategoria(container, transacoes, tipoUI, msgVazia) {
    const cores = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.categoria) || {};
    _renderListaAgrupadaPorTotal(container, transacoes, tipoUI, msgVazia, {
        chaveDe: t => t.categoria,
        semChave: 'Sem categoria',
        cores,
        gerarOpts: { semCategoriaChip: true }
    });
}

/** Lista simples, sem agrupamento — mais recente primeiro. */
function renderListaCronologica(container, transacoes, tipoUI, msgVazia) {
    if (!container) return;
    if (!transacoes || !transacoes.length) {
        container.innerHTML = `<p class="empty-message">${msgVazia}</p>`;
        container.onclick = null;
        return;
    }
    const itens = [...transacoes].sort(_porDataDesc);
    container.innerHTML = itens.map(t => gerarHTMLTransacao(t, tipoUI)).join('');
    container.onclick = onListaTransacaoClick;
}

const _porDataDesc = (a, b) => new Date(b.data) - new Date(a.data);

/**
 * Renderiza a lista de um tipo em subgrupos recolhíveis por tipo de recorrência.
 * Cada subgrupo mostra o total; começa recolhido (como as categorias na Config).
 */
function renderListaAgrupada(container, transacoes, tipoUI, msgVazia) {
    if (!container) return;
    if (!transacoes || !transacoes.length) {
        container.innerHTML = `<p class="empty-message">${msgVazia}</p>`;
        container.onclick = null;
        return;
    }

    const ehDespesa = tipoUI === 'saida';
    const cores = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.recorrencia) || {};
    const totalGrupo = arr => arr.reduce((s, t) => s + ((t.valorMes != null ? t.valorMes : t.valor) || 0), 0);
    const chaveDe = t => t.tipoRecorrencia || 'Pontual';

    // Ordem: Pontual primeiro, depois os fixos na ordem padrão
    const ordem = ['Pontual', ...ORDEM_RECORRENCIA.filter(t => t !== 'Pontual')];
    const conhecidos = new Set(ordem);
    const grupos = [];
    ordem.forEach(tipoRec => {
        const itens = transacoes.filter(t => chaveDe(t) === tipoRec).sort(_porDataDesc);
        if (itens.length) grupos.push([tipoRec, itens]);
    });
    const resto = transacoes.filter(t => !conhecidos.has(chaveDe(t))).sort(_porDataDesc);
    if (resto.length) grupos.push(['Outros', resto]);

    container.innerHTML = grupos.map(([tipoRec, itens]) => {
        const rotulo = (typeof rotuloRecorrencia === 'function') ? rotuloRecorrencia(tipoRec, ehDespesa) : tipoRec;
        const c = cores[tipoRec] || corPadraoChip(tipoRec);
        return `
        <details class="rec-grupo" style="--cor-rec:${c}">
          <summary>
            <span class="rec-grupo-nome">${rotulo}</span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total">${formatarMoeda(totalGrupo(itens))}</span>
          </summary>
          <div class="rec-grupo-itens">
            ${itens.map(t => gerarHTMLTransacao(t, tipoUI)).join('')}
          </div>
        </details>`;
    }).join('');

    container.onclick = onListaTransacaoClick;
}

// Cache das "próximas" (usado ao renderizar a aba Próximas)
let _proximasCtx = [];

/**
 * Gera HTML para uma transação — card único (sem versão compacta/expandida).
 * Layout: DIA DOW — VALOR MÉTODO CATEGORIA DESCRIÇÃO (linha que quebra).
 * opts.semMetodoChip: não mostra o chip de método (ex.: visão "Por método").
 * opts.comRecorrenciaChip: mostra o chip da recorrência no lugar do método.
 * opts.semCategoriaChip: não mostra o chip de categoria (visão "Por categoria").
 */
function gerarHTMLTransacao(trans, tipo, opts = {}) {
    const ehSemanalChips = trans.tipoRecorrencia === 'Semanal' && Array.isArray(trans.semanas) && trans.semanas.length;
    const valorFormatado = ehSemanalChips
        ? `${formatarMoeda(trans.valor)} <span class="valor-meta">/ ${formatarMoeda(trans.valorMes)}</span>`
        : formatarMoeda(trans.valor);
    const sinal = tipo === 'entrada' ? '+' : '-';

    // Cores dos "chips" (tarjinhas) de método / categoria / recorrência
    const cores = (estadoApp.menus && estadoApp.menus.cores) || {};
    const cor = (mapa, nome) => (mapa && mapa[nome]) || corPadraoChip(nome);
    const chip = (c, txt) => `<span class="chip" style="background:${c}" title="${String(txt).replace(/"/g, '&quot;')}">${txt}</span>`;

    // Dia do mês + tricode do dia da semana (ex.: 07 SEG)
    const _dowTri = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const _dt = trans.data ? parseDataLocal(trans.data) : null;
    const diaFormatado = _dt ? String(_dt.getDate()).padStart(2, '0') : '--';
    const dowFormatado = _dt ? _dowTri[_dt.getDay()] : '';

    const tagPendente = trans.pendente
        ? '<span class="pendente-badge">a confirmar</span>' : '';
    const quandoTag = opts.quando ? `<span class="quando-tag">${opts.quando}</span>` : '';

    const ehParcela = !!trans.parcelasTotal;
    const ehOriginal = ehParcela && trans.parcelaNum === 1;

    // Info da parcela (nunca vai para a descrição — vem dos campos da linha)
    const parcelaTag = ehParcela
        ? `<span class="parcela-tag" title="Parcelamento de ${formatarMoeda(trans.valorTotal || 0)}">${trans.parcelaNum}/${trans.parcelasTotal}</span>`
        : '';
    const quitadoTag = ehParcela && trans.quitadoEm
        ? `<span class="quitado-badge">quitado ${typeof mesTri === 'function' ? mesTri(String(trans.quitadoEm).slice(5, 7)) + '/' + String(trans.quitadoEm).slice(2, 4) : ''}</span>`
        : '';

    const lado = `<span class="despesa-data">`
        + `<span class="despesa-dia">${diaFormatado}</span>`
        + (dowFormatado ? `<span class="despesa-dow">${dowFormatado}</span>` : '')
        + `</span>`;

    // Chip de método OU de recorrência (visão "Por método")
    let metaChip = '';
    if (opts.comRecorrenciaChip) {
        const rec = trans.tipoRecorrencia || 'Pontual';
        const rot = (typeof rotuloRecorrencia === 'function') ? rotuloRecorrencia(rec, tipo === 'saida') : rec;
        metaChip = chip(cor(cores.recorrencia, rec), rot);
    } else if (!opts.semMetodoChip) {
        if (trans.metodo) {
            metaChip = chip(cor(cores.metodo, trans.metodo), trans.metodo);
        } else if (trans.formaPagamento && trans.formaPagamento !== 'À vista') {
            metaChip = `<span class="chip chip--neutro">${trans.formaPagamento}</span>`;
        }
    }
    const catChip = (!opts.semCategoriaChip && trans.categoria)
        ? chip(cor(cores.categoria, trans.categoria), trans.categoria) : '';
    const descTxt = trans.descricao
        ? `<span class="despesa-desc">${trans.descricao}</span>` : '';

    // Ações
    let acoes = '';
    if (!opts.semAcoes) {
        if (trans.pendente) {
            acoes += `<button class="btn-ok" data-act="confirmar-trans" data-id="${trans.id}" title="Confirmar este mês">OK</button>`;
        }
        if (ehParcela && !trans.quitada) {
            const chk = trans.quitadoEm ? 'checked' : '';
            acoes += `<label class="quitar-check" title="Quitar a partir deste mês"><input type="checkbox" data-act="quitar-parc" data-id="${trans.id}" ${chk}> quitar</label>`;
        }
        if (!ehParcela || ehOriginal) {
            acoes += `<button class="btn-icon" data-act="editar-trans" data-id="${trans.id}" title="Editar">✏️</button>`;
        }
        if (!trans.quitada) {
            acoes += `<button class="btn-icon btn-danger" data-act="excluir-trans" data-id="${trans.id}" title="Excluir">🗑️</button>`;
        }
    }

    const classes = `despesa-item ${tipo}`
        + (trans.pendente ? ' pendente' : '')
        + (trans.quitada ? ' quitada' : '');

    return `
        <div class="${classes}" data-id="${trans.id}" data-tipo-transacao="${tipo === 'entrada' ? 'entradas' : 'saidas'}">
            ${lado}
            <span class="despesa-valor">${sinal} ${valorFormatado}</span>
            ${metaChip}
            ${catChip}
            ${descTxt}
            ${parcelaTag}
            ${quandoTag}
            ${tagPendente}
            ${quitadoTag}
            <div class="despesa-actions">${acoes}</div>
        </div>`;
}

/** Delegação de clique nas listas de transações */
function onListaTransacaoClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = Number(el.dataset.id);

    const trans = [...estadoApp.transacoes.entradas, ...estadoApp.transacoes.saidas]
        .find(t => t.id === id);
    if (!trans) return;

    switch (el.dataset.act) {
        case 'confirmar-trans':
            confirmarPendente(id);
            break;
        case 'quitar-parc':
            quitarParcelamento(id, el.checked);
            break;
        case 'editar-trans': {
            const tipo = estadoApp.transacoes.entradas.some(t => t.id === id) ? 'entradas' : 'saidas';
            iniciarEdicaoTransacao(trans, tipo);
            break;
        }
        case 'excluir-trans':
            // Parcela que não é a original: aviso, sem arme de 2 cliques
            if (trans.parcelasTotal && trans.parcelaNum !== 1) {
                excluirTransacao(id); // deixa a API lançar o detalhe e o catch mostra o diálogo
            } else if (el.dataset.armed) {
                excluirTransacao(id);
            } else {
                const orig = el.textContent;
                el.dataset.armed = '1';
                el.textContent = 'excluir?';
                el.classList.add('armed');
                setTimeout(() => { delete el.dataset.armed; el.textContent = orig; el.classList.remove('armed'); }, 3000);
            }
            break;
    }
}

/** @returns {Promise<boolean>} true se realmente apagou */
async function excluirTransacao(id) {
    try {
        await deletarTransacaoAPI(id);
        mostrarNotificacao('Transação excluída', 'sucesso');
        await recarregarDados();
        atualizarUI();
        return true;
    } catch (e) {
        if (e && e.detalhe && e.detalhe.tipo === 'parcela-nao-original') {
            const comp = e.detalhe.competenciaOriginal;
            const label = competenciaParaBR(comp);
            mostrarDialogo({
                titulo: 'Só a 1ª parcela pode ser apagada',
                texto: `A parcela original está em <strong>${label}</strong>. Apagar a original remove todas as parcelas.`,
                acoes: [
                    { label: `Ir para ${label}`, primario: true, onClick: () => irParaMes(comp) },
                    { label: 'Fechar' }
                ]
            });
            return false;
        }
        console.error(e);
        mostrarNotificacao('Erro ao excluir', 'erro');
        return false;
    }
}

async function quitarParcelamento(id, quitar) {
    try {
        await quitarParcelamentoAPI(id, quitar);
        mostrarNotificacao(quitar ? '✓ Parcelamento quitado' : 'Quitação desfeita', 'sucesso');
        await recarregarDados();
        atualizarUI();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao quitar', 'erro');
        await recarregarDados();
        atualizarUI();
    }
}

/** Navega a visão mensal para a competência informada (YYYY-MM-01) */
function irParaMes(competencia) {
    if (!competencia) return;
    estadoApp.mesAtual = parseDataLocal(competencia);
    recarregarDados().then(atualizarUI);
}

async function confirmarPendente(id) {
    try {
        await confirmarPendenteAPI(id);
        mostrarNotificacao('✓ Mês confirmado', 'sucesso');
        await recarregarDados();
        atualizarUI();
    } catch (e) {
        console.error(e);
        mostrarNotificacao('Erro ao confirmar', 'erro');
    }
}

/** Carrega a transação no formulário da aba Adicionar em modo edição */
function iniciarEdicaoTransacao(trans, tipoTransacao) {
    estadoApp.editandoId = trans.id;
    // Guarda a tela de origem para voltar depois de salvar/cancelar
    estadoApp.abaOrigemEdicao = document.querySelector('.tab-btn.active')?.dataset.tab || null;

    mudarAba('adicionar');

    // Tipo (entrada/saída) sem recarregar menus
    estadoApp.tipoAtual = tipoTransacao;
    const tipoField = document.querySelector(SELECTORS.tipoTransacao);
    if (tipoField) tipoField.value = tipoTransacao;
    document.querySelectorAll('.tipo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tipo === tipoTransacao));
    atualizarLabelsPorTipo();

    document.querySelector(SELECTORS.data).value = isoParaDiaMes(trans.data);
    document.querySelector(SELECTORS.valor).value =
        (trans.tipoRecorrencia === 'Semanal' && trans.valorSessao != null) ? trans.valorSessao : trans.valor;
    semanasMarcadas = new Set(trans.semanas || []);
    document.querySelector(SELECTORS.categoria).value = trans.categoria;
    document.querySelector(SELECTORS.descricao).value = trans.descricao || '';
    document.querySelector(SELECTORS.metodo).value = trans.metodo || '';
    document.querySelector(SELECTORS.tipoRecorrencia).value = trans.tipoRecorrencia || 'Pontual';

    const diaRec = document.getElementById('diaRecorrencia');
    if (diaRec) diaRec.value = trans.diaRecorrencia || '';
    const pv = document.getElementById('pagarVencimento');
    if (pv) pv.checked = !!trans.pagarNoVencimento;
    const diaSem = document.getElementById('diaSemana');
    if (diaSem) diaSem.value = trans.diaSemana ?? '';
    const parc = document.getElementById('parcelas');
    if (parc) parc.value = 1;
    const comp = document.getElementById('competencia');
    if (comp) { comp.value = mesDeCompetencia(trans.competencia) || comp.value; comp.dataset.editado = "1"; }

    // Recorrências "dia útil fixo": restaura a competência
    const ehDiaUtil = typeof RECORRENCIA_DIA_UTIL !== 'undefined'
        && RECORRENCIA_DIA_UTIL.includes(trans.tipoRecorrencia);
    const compRec = document.getElementById('compRecorrente');
    if (compRec) compRec.value = ehDiaUtil ? mesDeCompetencia(trans.competencia) : '';

    atualizarCamposRecorrencia();
    atualizarCampoCredito();

    const btn = document.querySelector('.btn-submit');
    if (btn) btn.textContent = 'Salvar alterações';

    const excluir = document.getElementById('excluirEdicao');
    if (excluir) excluir.hidden = false;
}

/** Sai do modo edição e limpa o formulário (chamado pelo "×" do formulário) */
function cancelarEdicaoTransacao(voltarParaOrigem = true) {
    const origem = estadoApp.abaOrigemEdicao;
    estadoApp.editandoId = null;
    estadoApp.abaOrigemEdicao = null;
    semanasMarcadas = new Set();
    limparFormulario();
    const btn = document.querySelector('.btn-submit');
    if (btn) btn.textContent = 'Adicionar';
    const excluir = document.getElementById('excluirEdicao');
    if (excluir) excluir.hidden = true;
    // Cancelar pelo botão: volta para a tela onde o usuário estava
    if (voltarParaOrigem && origem && typeof mudarAba === 'function') mudarAba(origem);
}

/** Botão "Apagar" dentro do formulário de edição — confirmação nativa (confirm) */
async function excluirEdicaoTransacao() {
    const btn = document.getElementById('excluirEdicao');
    if (!btn || !estadoApp.editandoId) return;
    if (!confirm('Apagar este lançamento? Não dá para desfazer.')) return;

    const id = estadoApp.editandoId;
    const voltarPara = estadoApp.abaOrigemEdicao;
    const apagou = await excluirTransacao(id);
    if (!apagou) return; // erro real, ou o diálogo "só a 1ª parcela" — segue em edição

    estadoApp.editandoId = null;
    estadoApp.abaOrigemEdicao = null;
    limparFormulario();
    const submitBtn = document.querySelector('.btn-submit');
    if (submitBtn) submitBtn.textContent = 'Adicionar';
    btn.hidden = true;
    if (voltarPara && typeof mudarAba === 'function') mudarAba(voltarPara);
}

/**
 * Atualiza gráfico de categorias
 */
async function atualizarGrafico() {
    const container = document.querySelector(SELECTORS.categoriesList);
    if (!container) return;
    
    const transacoes = estadoApp.transacoes.saidas;
    
    // Agrupar por categoria
    const porCategoria = {};
    transacoes.forEach(trans => {
        if (!porCategoria[trans.categoria]) {
            porCategoria[trans.categoria] = 0;
        }
        porCategoria[trans.categoria] += trans.valor;
    });
    
    // Ordenar por valor decrescente
    const categoriasOrdenadas = Object.entries(porCategoria)
        .sort((a, b) => b[1] - a[1]);
    
    if (categoriasOrdenadas.length === 0) {
        container.innerHTML = '<p class="empty-message">Nenhuma despesa neste mês</p>';
        return;
    }
    
    // Total para percentual
    const total = Object.values(porCategoria).reduce((a, b) => a + b, 0);
    
    // Gerar HTML
    let html = '';
    categoriasOrdenadas.forEach((entrada, index) => {
        const [categoria, valor] = entrada;
        const percentual = total > 0 ? (valor / total) * 100 : 0;
        const cor = CORES_CATEGORIAS[index % CORES_CATEGORIAS.length];
        
        html += `
            <div class="category-item">
                <div class="category-color" style="background-color: ${cor};"></div>
                <div class="category-info">
                    <div class="category-name">${categoria}</div>
                    <div class="category-bar">
                        <div class="category-fill" style="width: ${percentual}%; background-color: ${cor};"></div>
                    </div>
                </div>
                <div class="category-value">
                    ${formatarMoeda(valor)} (${percentual.toFixed(1)}%)
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// "Despesa" (padrão) | "Receita" — qual tipo a aba Próximas está mostrando
let tipoProximasAtual = (() => {
    try {
        const salvo = localStorage.getItem('tipoProximas');
        return salvo === 'entradas' ? 'entradas' : 'saidas';
    } catch (_) { return 'saidas'; }
})();

// Modos de agrupamento disponíveis em Próximas — "Por método" só faz
// sentido pra despesa (receita não usa esse campo).
const MODOS_PROXIMAS_SAIDAS = ['recorrencia', 'metodo', 'categoria', 'cronologica'];
const MODOS_PROXIMAS_ENTRADAS = ['recorrencia', 'categoria', 'cronologica'];
const ROTULOS_MODO_PROXIMAS = {
    recorrencia: 'Por recorrência', metodo: 'Por método', categoria: 'Por categoria', cronologica: 'Cronológica'
};
function _modosProximasValidos() {
    return tipoProximasAtual === 'entradas' ? MODOS_PROXIMAS_ENTRADAS : MODOS_PROXIMAS_SAIDAS;
}

let modoListaProximas = _modoListaSalvo('modoListaProximas', MODOS_PROXIMAS_SAIDAS);

/** Troca entre "Despesa"/"Receita" em Próximas — refaz os botões de modo
 *  (o conjunto válido muda: receita não tem "Por método") e recarrega. */
function definirTipoProximas(tipo) {
    tipoProximasAtual = tipo === 'entradas' ? 'entradas' : 'saidas';
    try { localStorage.setItem('tipoProximas', tipoProximasAtual); } catch (_) {}
    atualizarProximasTransacoes();
}

function definirModoListaProximas(modo) {
    const validos = _modosProximasValidos();
    modoListaProximas = validos.includes(modo) ? modo : 'recorrencia';
    try { localStorage.setItem('modoListaProximas', modoListaProximas); } catch (_) {}
    atualizarProximasTransacoes();
}

/** Redesenha os botões de modo pro tipo atual (o conjunto de opções muda
 *  entre Despesa e Receita) e corrige modoListaProximas se ele não existir
 *  mais nesse conjunto (ex.: estava em "Por método" e trocou pra Receita). */
function _renderBotoesModoProximas() {
    const el = document.getElementById('modoProximas');
    if (!el) return;
    const validos = _modosProximasValidos();
    if (!validos.includes(modoListaProximas)) modoListaProximas = 'recorrencia';
    el.innerHTML = validos.map(m =>
        `<button type="button" class="modo-btn${m === modoListaProximas ? ' active' : ''}" data-modo="${m}">${ROTULOS_MODO_PROXIMAS[m]}</button>`
    ).join('');
}

const _porDataAsc = (a, b) => new Date(a.data) - new Date(b.data);

/**
 * Atualiza lista de próximas transações (só do tipo selecionado — Despesa ou Receita)
 */
async function atualizarProximasTransacoes() {
    const container = document.querySelector(SELECTORS.proximasLista);
    if (!container) return;

    document.querySelectorAll('#tipoProximas .tipo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tipo === tipoProximasAtual));
    _renderBotoesModoProximas();

    try {
        // Próximas do MÊS em exibição
        const mRef = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual) ? estadoApp.mesAtual : new Date();
        const mes = mRef.getMonth() + 1, ano = mRef.getFullYear();
        const elTit = document.getElementById('proximasTitulo');
        if (elTit) {
            // 4 níveis conforme o espaço aperta (mesma ideia do mês no topo):
            // "Próximos lançamentos em setembro de 2026" -> "Próx. lançamentos
            // em setembro de 2026" -> "Próx. lançamentos em SET/2026" ->
            // "Próx. lançamentos 09/26"
            const mesPorExtenso = obterMesAnoFormatado(mRef).toLowerCase();
            const mesCurto = obterMesAnoCurto(mRef);
            const mesMini = obterMesAnoMini(mRef);
            elTit.innerHTML =
                `<span class="prox-titulo-full">Próximos lançamentos em ${mesPorExtenso}</span>` +
                `<span class="prox-titulo-media">Próx. lançamentos em ${mesPorExtenso}</span>` +
                `<span class="prox-titulo-curto">Próx. lançamentos em ${mesCurto}</span>` +
                `<span class="prox-titulo-mini">Próx. lançamentos ${mesMini}</span>`;
        }

        const ehDespesa = tipoProximasAtual !== 'entradas';
        const proximas = await carregarProximas(tipoProximasAtual, mes, ano);
        const tipoUI = ehDespesa ? 'saida' : 'entrada';

        // Faturas de cartão só fazem sentido olhando pras despesas
        const faturasHTML = ehDespesa ? renderFaturasCartao() : '';

        if (proximas.length === 0) {
            container.innerHTML = faturasHTML
                + `<p class="empty-message">Nada programado para ${obterMesAnoFormatado(mRef)}</p>`;
            container.onclick = null;
            _proximasCtx = [];
            return;
        }

        // Mesmo box de Receitas/Despesas: dia da ocorrência + valor, expansível
        _proximasCtx = proximas.map(trans => {
            const dias = calcularDiasAte(trans.data);
            const quando = dias <= 0 ? 'hoje' : `em ${dias}d`;
            // Mesmo lançamento que aparece em Receitas/Despesas — os botões
            // (OK / editar / excluir) valem aqui também, e agem no mesmo
            // registro: confirmar/editar/excluir daqui reflete lá (e vice-versa).
            return { trans: { ...trans }, tipoUI, opts: { quando } };
        });

        const corpoHTML = modoListaProximas === 'metodo'
            ? _agruparProximasPorTotal(_proximasCtx, {
                chaveDe: c => c.trans.metodo, semChave: 'Sem método',
                cores: (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.metodo) || {},
                extraOpts: { comRecorrenciaChip: true }
            })
            : modoListaProximas === 'categoria'
            ? _agruparProximasPorTotal(_proximasCtx, {
                chaveDe: c => c.trans.categoria, semChave: 'Sem categoria',
                cores: (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.categoria) || {},
                extraOpts: { semCategoriaChip: true }
            })
            : modoListaProximas === 'recorrencia'
            ? _agruparProximasPorRecorrencia(_proximasCtx)
            : _proximasCtx.map(c => gerarHTMLTransacao(c.trans, c.tipoUI, c.opts)).join('');

        container.innerHTML = faturasHTML + corpoHTML;
        container.onclick = onListaTransacaoClick;
    } catch (error) {
        console.error('Erro ao atualizar próximas transações:', error);
        container.innerHTML = '<p class="empty-message">Erro ao carregar próximas transações</p>';
    }
}

/** "Próximas" agrupadas por método ou categoria (ordenado por total, maior
 *  primeiro) — mistura entrada/saída, então cada item usa o tipoUI/opts que
 *  já vêm prontos no seu próprio contexto (c.trans/c.tipoUI/c.opts). */
function _agruparProximasPorTotal(ctxList, { chaveDe, semChave, cores, extraOpts }) {
    const valorDe = c => (c.trans.valorMes != null ? c.trans.valorMes : c.trans.valor) || 0;
    const mapa = new Map();
    ctxList.forEach(c => {
        const k = chaveDe(c) || semChave;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(c);
    });
    const grupos = [...mapa.entries()]
        .map(([nome, itens]) => [nome, itens.sort((a, b) => _porDataAsc(a.trans, b.trans)), itens.reduce((s, c) => s + valorDe(c), 0)])
        .sort((a, b) => b[2] - a[2]);
    const totalGeral = grupos.reduce((s, g) => s + g[2], 0);

    return grupos.map(([nome, itens, total]) => {
        const c = cores[nome] || corPadraoChip(nome);
        const pct = totalGeral ? Math.round((total / totalGeral) * 100) : 0;
        return `
        <details class="rec-grupo" style="--cor-rec:${c}">
          <summary>
            <span class="rec-grupo-nome">${nome}</span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total">${formatarMoeda(total)}${totalGeral ? ` · ${pct}%` : ''}</span>
          </summary>
          <div class="rec-grupo-itens">
            ${itens.map(c2 => gerarHTMLTransacao(c2.trans, c2.tipoUI, { ...c2.opts, ...extraOpts })).join('')}
          </div>
        </details>`;
    }).join('');
}

/** "Próximas" agrupadas por tipo de recorrência, na ordem fixa de sempre
 *  (Pontual primeiro) — mesma ideia de renderListaAgrupada, mas por cima do
 *  contexto misto entrada/saída de _proximasCtx. */
function _agruparProximasPorRecorrencia(ctxList) {
    const cores = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.recorrencia) || {};
    const chaveDe = c => c.trans.tipoRecorrencia || 'Pontual';
    const ordem = ['Pontual', ...ORDEM_RECORRENCIA.filter(t => t !== 'Pontual')];
    const conhecidos = new Set(ordem);

    const grupos = [];
    ordem.forEach(tipoRec => {
        const itens = ctxList.filter(c => chaveDe(c) === tipoRec).sort((a, b) => _porDataAsc(a.trans, b.trans));
        if (itens.length) grupos.push([tipoRec, itens]);
    });
    const resto = ctxList.filter(c => !conhecidos.has(chaveDe(c))).sort((a, b) => _porDataAsc(a.trans, b.trans));
    if (resto.length) grupos.push(['Outros', resto]);

    const totalGrupo = arr => arr.reduce((s, c) => s + ((c.trans.valorMes != null ? c.trans.valorMes : c.trans.valor) || 0), 0);

    return grupos.map(([tipoRec, itens]) => {
        const rotulo = (typeof rotuloRecorrencia === 'function') ? rotuloRecorrencia(tipoRec, false) : tipoRec;
        const c = cores[tipoRec] || corPadraoChip(tipoRec);
        return `
        <details class="rec-grupo" style="--cor-rec:${c}">
          <summary>
            <span class="rec-grupo-nome">${rotulo}</span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total">${formatarMoeda(totalGrupo(itens))}</span>
          </summary>
          <div class="rec-grupo-itens">
            ${itens.map(c2 => gerarHTMLTransacao(c2.trans, c2.tipoUI, c2.opts)).join('')}
          </div>
        </details>`;
    }).join('');
}

/** Bloco "Faturas de cartão" no topo das Próximas: cada cartão de crédito
 *  com o total lançado no mês e o dia de vencimento. */
function renderFaturasCartao() {
    const cartoes = ((estadoApp.menus && estadoApp.menus.metodos) || [])
        .filter(m => m.metodoKind === 'Crédito');
    if (!cartoes.length) return '';
    const mes = estadoApp.mesAtual || new Date();
    const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
    const coresMet = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.metodo) || {};
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;

    const linhas = cartoes.map(m => {
        const rot = (typeof rotuloMetodo === 'function') ? rotuloMetodo(m) : m.nome;
        const total = estadoApp.transacoes.saidas
            .filter(t => t.metodo === rot)
            .reduce((s, t) => s + valorDe(t), 0);
        if (!total) return '';
        const diaV = Math.min(parseInt(m.diaVencimento, 10) || 1, ultimoDia);
        const venc = `${String(diaV).padStart(2, '0')}/${String(mes.getMonth() + 1).padStart(2, '0')}`;
        const cor = coresMet[rot] || (typeof corPadraoChip === 'function' ? corPadraoChip(rot) : 'var(--primary)');
        return `
        <div class="fatura-item" style="--cor-cartao:${cor}">
            <span class="fatura-nome">${rot}</span>
            <span class="fatura-venc">vence ${venc}</span>
            <span class="fatura-total">${formatarMoeda(total)}</span>
        </div>`;
    }).filter(Boolean).join('');

    return linhas
        ? `<div class="faturas-cartao"><h3 class="faturas-titulo">Faturas de cartão</h3>${linhas}</div>`
        : '';
}

/**
 * Define o texto de um label usando a versão curta quando a completa não
 * couber em uma única linha (labels nunca podem quebrar linha no formulário).
 */
function definirLabelResp(sel, full, short) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return;
    el.textContent = full;
    if (!short) return;
    const semEspaco = window.innerWidth < 560
        || (el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1);
    if (semEspaco) el.textContent = short;
}

/**
 * Quando, no grid de campos, o último campo visível fica sozinho na linha,
 * faz ele ocupar 100% da largura (ex.: "Descrição").
 */
function ajustarCamposSozinhos() {
    const grid = document.getElementById('linhaCampos');
    if (!grid) return;
    grid.querySelectorAll('.solo').forEach(el => el.classList.remove('solo'));
    const cols = (getComputedStyle(grid).gridTemplateColumns.match(/px|fr|%|rem/g) || []).length
        || getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1;
    const cells = [...grid.children].filter(el => !el.hidden && el.offsetParent !== null);
    if (cols > 1 && cells.length % cols === 1) {
        cells[cells.length - 1].classList.add('solo');
    }
}

/**
 * Mostra/esconde os campos que dependem do tipo de recorrência
 * (dia + checkbox "vencimento" para Mensal/Parcelada; nº de parcelas para Parcelada)
 */
function atualizarCamposRecorrencia() {
    const tipo = document.querySelector(SELECTORS.tipoRecorrencia).value;
    const ehReceita = document.querySelector(SELECTORS.tipoTransacao)?.value === 'entradas';
    const comDia = tipo === 'Mensal' || tipo === 'Parcelada';
    const ehSemanal = tipo === 'Semanal';
    const ehCalculada = typeof RECORRENCIA_DIA_UTIL !== 'undefined'
        && RECORRENCIA_DIA_UTIL.includes(tipo);
    // Receita Mensal/Parcelada: a data é automática = próximo dia útil (sem checkbox)
    const receitaAuto = ehReceita && comDia;

    const set = (id, mostrar) => { const el = document.getElementById(id); if (el) el.hidden = !mostrar; };
    set('diaRecorrenciaGroup', comDia);
    set('parceleGroup', tipo === 'Parcelada');
    set('diaSemanaGroup', ehSemanal);
    set('mesRefGroup', false);   // "Mês de ref." não aparece mais; usa o mês em exibição
    set('dataCalculadaGroup', ehCalculada);
    set('semanasChipsGroup', ehSemanal);
    // Valor se divide em 2 (informado + total) em Semanal e Parcelada
    set('valorTotalGroup', ehSemanal || tipo === 'Parcelada');

    const metodoAtual = typeof metodoSelecionado === 'function' ? metodoSelecionado() : null;
    const ehCredito = !ehReceita && !!metodoAtual && metodoAtual.metodoKind === 'Crédito';
    const credito = ehCredito && comDia;

    // "Comp." (competência): não existe uma única competência pra Parcelada —
    // cada parcela cai num mês diferente — então some da tela nesse caso. O
    // select continua sendo recalculado (recalcularCompetencia) mesmo escondido,
    // porque a data de vencimento do cartão ainda precisa saber o mês de referência.
    const compGrupo = document.getElementById('competenciaGroup');
    if (compGrupo) compGrupo.hidden = !ehCredito || tipo === 'Parcelada';

    // Checkbox "pagar no vencimento": só despesa com dia de vencimento (Contas/Parcelada).
    // No cartão de crédito isso deixa de ser opcional — quem manda é o vencimento do
    // cartão, então o checkbox some e o comportamento fica sempre ligado.
    const chkWrap = document.getElementById('pagarVencimentoWrap');
    if (chkWrap) chkWrap.hidden = ehReceita || !comDia || credito;
    const chk = document.getElementById('pagarVencimento');
    if (chk) {
        if (credito) {
            chk.checked = true;
            chk.dataset.forcadoCredito = '1';
        } else if (ehReceita || !comDia || chk.dataset.forcadoCredito) {
            // Some das telas de Receita/sem-dia, ou deixou de ser cartão de
            // crédito: se o "check" tinha sido ligado à força por causa do
            // cartão (e não pelo usuário), desliga de volta.
            chk.checked = false;
            delete chk.dataset.forcadoCredito;
        }
    }

    // Campo "Data" livre: escondido para dia-útil fixo e Semanal
    const mostrarData = !ehCalculada && !ehSemanal;
    set('dataGroup', mostrarData);
    const dataMain = document.querySelector(SELECTORS.data);
    if (dataMain) dataMain.required = mostrarData;

    // Rótulos do contexto (nunca ocupam mais de 1 linha; encurtam em tela estreita)
    if (receitaAuto || (!ehReceita && comDia)) {
        definirLabelResp('label[for="data"]', 'Pagamento', 'Pgto.');
    } else {
        definirLabelResp('label[for="data"]', 'Data', null);
    }
    const grpDiaRec = document.getElementById('diaRecorrenciaGroup');
    if (grpDiaRec) grpDiaRec.classList.toggle('campo-mini--wide', ehReceita);
    definirLabelResp('label[for="diaRecorrencia"]',
        ehReceita ? 'dia pgto.' : 'vcto.',
        ehReceita ? 'dia pg.' : 'vcto.');
    definirLabelResp('label[for="parcelas"]', 'qtd.', 'qtd.');
    atualizarValorTotal();

    // Cartão de crédito: o dia de vencimento é o do cartão, não dá pra escolher.
    // Fora isso, só um prefill (com o dia da data digitada) pra quem ainda não mexeu.
    const diaInput = document.getElementById('diaRecorrencia');
    if (diaInput) {
        if (credito) {
            diaInput.value = metodoAtual.diaVencimento != null ? String(metodoAtual.diaVencimento) : '';
            diaInput.readOnly = true;
            diaInput.classList.add('campo-travado');
        } else {
            diaInput.readOnly = false;
            diaInput.classList.remove('campo-travado');
            if (comDia && !diaInput.value) {
                const iso = dataCampoParaISO(document.querySelector(SELECTORS.data).value);
                if (iso) diaInput.value = String(parseInt(iso.slice(8, 10), 10));
            }
        }
    }

    // Guarda a data livre atual antes de qualquer cálculo automático sobrescrevê-la
    if (dataMain && (ehCalculada || receitaAuto) && !dataMain.readOnly && !dataMain.dataset.userVal) {
        dataMain.dataset.userVal = dataMain.value;
    }

    // Data derivada da competência (primeiro / 5º / último dia útil, deste mês ou do anterior)
    if (ehCalculada) {
        definirLabelResp('label[for="dataCalculada"]', 'Data', null);
        // "Mês de ref." não é mais editável: usa o mês em exibição (na edição, mantém o gravado)
        const compEl = document.getElementById('compRecorrente');
        const editando = typeof estadoApp !== 'undefined' && estadoApp.editandoId;
        if (compEl && !editando && typeof estadoApp !== 'undefined' && estadoApp.mesAtual) {
            compEl.value = mesDeCompetencia(formatarDataISO(estadoApp.mesAtual));
        }
        const compISO = competenciaDeMes(compEl ? compEl.value : '');
        const dataISO = compISO ? dataDiaUtilPorCompetencia(compISO, tipo) : '';
        const campo = document.getElementById('dataCalculada');
        if (campo) campo.value = dataISO ? isoParaDiaMes(dataISO) : "";
        if (dataMain && dataISO) dataMain.value = isoParaDiaMes(dataISO);
    }

    // Receita Mensal/Parcelada: data automática = dia informado no próximo dia útil
    if (dataMain) {
        if (receitaAuto) {
            dataMain.dataset.autoReceita = '1';
            const compISO = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual)
                ? formatarDataISO(estadoApp.mesAtual) : hojeISO();
            const dia = document.getElementById('diaRecorrencia')?.value || '';
            dataMain.value = isoParaDiaMes(dataReceitaMensal(compISO, dia));
            dataMain.readOnly = true;
            dataMain.classList.add('campo-travado');
        } else {
            delete dataMain.dataset.autoReceita;
            // Voltou para uma data livre: restaura o que o usuário tinha digitado
            if (!ehCalculada && dataMain.readOnly) {
                dataMain.readOnly = false;
                dataMain.classList.remove('campo-travado');
            }
            if (mostrarData && dataMain.dataset.userVal != null && !chk?.checked) {
                dataMain.value = dataMain.dataset.userVal;
                delete dataMain.dataset.userVal;
            }
        }
    }

    // Semanal: chips por semana (numeradas), dentro da metade da "Data"
    if (ehSemanal) renderSemanasChips();

    // Recalcula a competência só agora, com a "Data" já no valor final (livre,
    // travada por vencimento, etc.) — precisa vir antes de aplicarPagarVencimento(),
    // que lê o mês daqui pra calcular a data de vencimento do cartão.
    if (ehCredito && typeof recalcularCompetencia === 'function') recalcularCompetencia();

    // "Pagar no vencimento": trava a data do lançamento no dia do vencimento (despesa)
    aplicarPagarVencimento();

    ajustarCamposSozinhos();
}

/**
 * Ajusta rótulos e campos conforme o tipo (receita = entradas | despesa = saidas):
 * - receita não tem método (campo escondido, não obrigatório)
 * - "Dia de vencimento" vira "Dia do pagamento"; checkbox muda de texto
 */
function atualizarLabelsPorTipo() {
    const ehReceita = document.querySelector(SELECTORS.tipoTransacao)?.value === 'entradas';

    const metodoSel = document.querySelector(SELECTORS.metodo);
    // Esconde o bloco inteiro (não só o form-group do método) pra "Valor"
    // ocupar 100% da linha quando é receita, em vez de sobrar um buraco.
    const blocoMetodo = document.getElementById('metodoBloco');
    if (blocoMetodo) blocoMetodo.hidden = ehReceita;
    if (metodoSel) {
        metodoSel.required = !ehReceita;
        if (ehReceita) metodoSel.value = '';
    }
    if (ehReceita) {
        const compGrp = document.getElementById('competenciaGroup');
        if (compGrp) compGrp.hidden = true;
    } else if (typeof atualizarCampoCredito === 'function') {
        atualizarCampoCredito();
    }

    const grpDiaRec2 = document.getElementById('diaRecorrenciaGroup');
    if (grpDiaRec2) grpDiaRec2.classList.toggle('campo-mini--wide', ehReceita);
    definirLabelResp('label[for="diaRecorrencia"]',
        ehReceita ? 'dia pgto.' : 'vcto.',
        ehReceita ? 'dia pg.' : 'vcto.');
    const lblChk = document.getElementById('pagarVencimentoLabel');
    if (lblChk) lblChk.textContent = ehReceita ? 'receber neste dia' : 'pagar no vcto.';

    // Recorrência "Mensal" aparece como "Contas" nas despesas -> refaz o dropdown
    if (typeof preencherDropdownRecorrencias === 'function') preencherDropdownRecorrencias();
    // Categorias são específicas de receita x despesa
    if (typeof preencherDropdownCategorias === 'function') preencherDropdownCategorias();

    ajustarCamposSozinhos();
}

/**
 * Diálogo rápido para criar uma categoria.
 * @param {'saidas'|'entradas'} [catTipo] tipo da categoria; se omitido usa o tipo atual do formulário
 */
function abrirNovaCategoria(catTipo) {
    const tipo = (catTipo === 'entradas' || catTipo === 'saidas')
        ? catTipo
        : (estadoApp.tipoAtual === 'entradas' ? 'entradas' : 'saidas');
    const rotulo = tipo === 'entradas' ? 'receita' : 'despesa';
    mostrarDialogo({
        titulo: `Nova categoria de ${rotulo}`,
        corpoHTML: `
            <div class="campo"><label for="dlgCatNome">Nome</label>
                <input type="text" id="dlgCatNome" placeholder="Ex: Mercado" autocomplete="off"></div>
            <div class="campo"><label for="dlgCatDesc">Descrição <span class="opt">(opcional)</span></label>
                <input type="text" id="dlgCatDesc" autocomplete="off"></div>`,
        acoes: [
            { label: 'Cancelar' },
            { label: 'Adicionar', primario: true, onClick: async (ov) => {
                const nome = ov.querySelector('#dlgCatNome').value.trim();
                if (!nome) { mostrarNotificacao('Informe o nome', 'info'); return true; }
                const ok = await adicionarItemMenuAPI('Categoria', nome, {
                    descricao: ov.querySelector('#dlgCatDesc').value.trim(),
                    categoria_tipo: tipo,
                    cor: corPadraoChip(nome)
                });
                if (!ok) return true;
                await carregarMenus();
                if (typeof carregarAbaMenus === "function") await carregarAbaMenus();
                const sel = document.querySelector(SELECTORS.categoria);
                if (sel && tipo === (estadoApp.tipoAtual === 'entradas' ? 'entradas' : 'saidas')) sel.value = nome;
            } }
        ]
    });
}

/** Diálogo rápido para criar um método a partir do formulário */
function abrirNovoMetodo() {
    const ov = mostrarDialogo({
        titulo: 'Novo método',
        corpoHTML: `
            <div class="campo"><label for="dlgMetKind">Tipo</label>
                <select id="dlgMetKind">
                    <option value="">Selecione...</option>
                    <option value="PIX/Débito">PIX/Débito</option>
                    <option value="Crédito">Crédito</option>
                </select></div>
            <div class="campo"><label for="dlgMetBanco">Banco <span class="opt" id="dlgMetBancoOpt">(opcional)</span></label>
                <input type="text" id="dlgMetBanco" placeholder="Ex: Nubank" autocomplete="off"></div>
            <div class="campo" id="dlgMetVencWrap" hidden><label for="dlgMetVenc">Vencimento (dia)</label>
                <input type="text" id="dlgMetVenc" inputmode="numeric" maxlength="2"></div>
            <div id="dlgMetCartao" hidden>
                <div class="campo"><label for="dlgMetFech">Fechamento (dia) <span class="opt">(opcional)</span></label>
                    <input type="text" id="dlgMetFech" inputmode="numeric" maxlength="2"></div>
                <div class="campo"><label for="dlgMetMelhor">Melhor dia <span class="opt">(opcional)</span></label>
                    <input type="text" id="dlgMetMelhor" inputmode="numeric" maxlength="2"></div>
            </div>`,
        acoes: [
            { label: 'Cancelar' },
            { label: 'Adicionar', primario: true, onClick: async (o) => {
                const kind = o.querySelector('#dlgMetKind').value;
                const banco = o.querySelector('#dlgMetBanco').value.trim();
                if (!kind) { mostrarNotificacao('Escolha o tipo', 'info'); return true; }
                if (kind === 'Crédito' && !banco) { mostrarNotificacao('Informe o banco', 'info'); return true; }
                const nome = banco ? `${kind} — ${banco}` : kind;
                const extra = { metodo_kind: kind, banco, cor: corPadraoChip(nome) };
                if (kind === 'Crédito') {
                    const fech = parseInt(o.querySelector('#dlgMetFech').value, 10);
                    const venc = parseInt(o.querySelector('#dlgMetVenc').value, 10);
                    if (!(venc >= 1 && venc <= 31)) { mostrarNotificacao('Vencimento inválido', 'erro'); return true; }
                    const temFech = fech >= 1 && fech <= 31;
                    if (o.querySelector('#dlgMetFech').value.trim() && !temFech) {
                        mostrarNotificacao('Fechamento inválido', 'erro'); return true;
                    }
                    const melhor = parseInt(o.querySelector('#dlgMetMelhor').value, 10)
                        || (temFech ? sugerirMelhorDiaCompra(fech) : null) || null;
                    extra.dia_vencimento = venc;
                    if (temFech) extra.dia_fechamento = fech;
                    if (melhor) extra.melhor_dia_compra = melhor;
                }
                const ok = await adicionarItemMenuAPI('Método', nome, extra);
                if (!ok) return true;
                await carregarMenus();
                if (typeof carregarAbaMenus === "function") await carregarAbaMenus();
                const sel = document.querySelector(SELECTORS.metodo);
                if (sel) sel.value = nome;
                if (typeof atualizarCampoCredito === 'function') atualizarCampoCredito();
            } }
        ]
    });
    const kindSel = ov.querySelector('#dlgMetKind');
    kindSel.addEventListener('change', () => {
        const ehCredito = kindSel.value === 'Crédito';
        ov.querySelector('#dlgMetVencWrap').hidden = !ehCredito;
        ov.querySelector('#dlgMetCartao').hidden = !ehCredito;
        ov.querySelector('#dlgMetBancoOpt').hidden = ehCredito;
    });
    ov.querySelectorAll('input[inputmode="numeric"]').forEach(inp =>
        inp.addEventListener('input', () => soNumeros(inp, 2)));

    // "Melhor dia" sugerido automaticamente a partir do Fechamento
    const fechInp = ov.querySelector('#dlgMetFech');
    const melhorInp = ov.querySelector('#dlgMetMelhor');
    if (fechInp && melhorInp && typeof sugerirMelhorDiaCompra === 'function') {
        fechInp.addEventListener('input', () => {
            const f = parseInt(fechInp.value, 10);
            if (f >= 1 && f <= 31 && (!melhorInp.value || melhorInp.dataset.auto)) {
                melhorInp.value = sugerirMelhorDiaCompra(f);
                melhorInp.dataset.auto = '1';
            } else if (!(f >= 1 && f <= 31) && melhorInp.dataset.auto) {
                melhorInp.value = '';
            }
        });
        melhorInp.addEventListener('input', () => { delete melhorInp.dataset.auto; });
    }
}

/**
 * Quando "pagar no vencimento" está marcado, a data do lançamento fica igual à
 * data de vencimento (dia informado, na competência atual) e o campo Data trava.
 */
function aplicarPagarVencimento() {
    const chk = document.getElementById('pagarVencimento');
    const dataEl = document.querySelector(SELECTORS.data);
    if (!chk || !dataEl) return;
    if (dataEl.dataset.autoReceita === '1') return;  // já travado por "próximo dia útil"

    const grupoDia = document.getElementById('diaRecorrenciaGroup');
    // Sem campo de dia de vencimento visível: o checkbox não se aplica; a data
    // é gerenciada por atualizarCamposRecorrencia (não mexer aqui).
    if (!grupoDia || grupoDia.hidden) return;
    const ativo = chk.checked;

    if (ativo) {
        if (dataEl.dataset.userVal == null) dataEl.dataset.userVal = dataEl.value;
        const dia = document.getElementById('diaRecorrencia').value;
        const compBR = document.getElementById('competencia')?.value;
        const compISO = competenciaDeMes(compBR || "") ||
            competenciaDe(dataCampoParaISO(dataEl.value) || hojeISO());
        const venc = dataVencimento(compISO, dia);
        if (venc) dataEl.value = isoParaDiaMes(venc);
        dataEl.readOnly = true;
        dataEl.classList.add('campo-travado');
    } else {
        dataEl.readOnly = false;
        dataEl.classList.remove('campo-travado');
        // Desmarcou: a data volta para o valor original que estava antes
        if (dataEl.dataset.userVal != null) {
            dataEl.value = dataEl.dataset.userVal;
            delete dataEl.dataset.userVal;
        }
    }
}

// Conjunto de datas (YYYY-MM-DD) marcadas nas chips do formulário
let semanasMarcadas = new Set();

const DOW_ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** (Re)desenha as chips de semanas para o mês/dia-da-semana atuais do formulário */
function renderSemanasChips() {
    const box = document.getElementById('semanasChips');
    if (!box) return;
    const dow = parseInt(document.getElementById('diaSemana').value, 10);
    const temDiaFixo = Number.isInteger(dow) && dow >= 0 && dow <= 6;
    // Semanal não tem campo de data -> usa o mês em exibição
    const iso = dataCampoParaISO(document.querySelector(SELECTORS.data).value)
        || (typeof estadoApp !== 'undefined' && estadoApp.mesAtual ? formatarDataISO(estadoApp.mesAtual) : hojeISO());
    if (!iso) { box.innerHTML = ''; return; }

    const d = parseDataLocal(iso);
    let dias;
    if (temDiaFixo) {
        dias = ocorrenciasDoDiaNoMes(d.getFullYear(), d.getMonth(), dow);
    } else {
        // Sem dia fixo: uma "semana N" por semana do mês
        const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const nSemanas = Math.ceil(ultimoDia / 7);
        dias = [];
        for (let i = 0; i < nSemanas; i++) {
            const diaMes = Math.min(1 + i * 7, ultimoDia);
            dias.push(formatarDataISO(new Date(d.getFullYear(), d.getMonth(), diaMes)));
        }
    }
    const hoje = hojeISO();

    // Reinicia (futuras marcadas) se o conjunto atual não pertence a este mês
    const pertence = [...semanasMarcadas].some(x => dias.includes(x));
    if (!pertence) semanasMarcadas = new Set(dias.filter(x => x > hoje));
    // Mantém só as datas válidas deste mês
    semanasMarcadas = new Set([...semanasMarcadas].filter(x => dias.includes(x)));

    box.innerHTML = dias.map((dt, i) => {
        const marc = semanasMarcadas.has(dt);
        const passada = dt <= hoje;
        const rot = temDiaFixo ? dt.slice(8, 10) : String(i + 1);
        return `<button type="button" class="chip${marc ? ' on' : ''}${passada ? ' passada' : ''}" data-dt="${dt}" title="${dt.split('-').reverse().join('/')}">${rot}</button>`;
    }).join('');

    box.onclick = e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const dt = chip.dataset.dt;
        if (semanasMarcadas.has(dt)) semanasMarcadas.delete(dt);
        else semanasMarcadas.add(dt);
        chip.classList.toggle('on');
        atualizarResumoSemanas();
        atualizarValorTotal();
    };

    atualizarResumoSemanas();
}

/** Resumo semanal: "<já lançado> / <total>" (sem rótulos) */
function atualizarResumoSemanas() {
    const el = document.getElementById('semanasResumo');
    if (!el) return;
    const vs = parseFloat(document.querySelector(SELECTORS.valor).value) || 0;
    const hoje = hojeISO();
    const marc = [...semanasMarcadas];
    const x = marc.filter(dt => dt <= hoje).length * vs;
    const y = marc.length * vs;
    el.textContent = `${formatarMoeda(x)} / ${formatarMoeda(y)}`;
}

/** Preenche o campo "Total" (readonly) ao lado do Valor em Semanal/Parcelada */
function atualizarValorTotal() {
    const tot = document.getElementById('valorTotal');
    if (!tot) return;
    const tipo = document.querySelector(SELECTORS.tipoRecorrencia)?.value;
    const v = parseFloat(document.querySelector(SELECTORS.valor)?.value) || 0;
    let mult = 0;
    if (tipo === 'Parcelada') {
        mult = parseInt(document.getElementById('parcelas')?.value, 10) || 0;
    } else if (tipo === 'Semanal') {
        mult = (typeof semanasMarcadas !== 'undefined') ? semanasMarcadas.size : 0;
    }
    tot.value = formatarMoeda(v * mult);
}

/**
 * Chamado quando o Método muda. O campo Competência (visibilidade + valor) e
 * o vencimento do cartão (dia travado + data de pagamento) dependem tanto do
 * método quanto da recorrência escolhida, então tudo isso é recalculado
 * junto em atualizarCamposRecorrencia().
 */
function atualizarCampoCredito() {
    if (typeof atualizarCamposRecorrencia === 'function') atualizarCamposRecorrencia();
}

/**
 * Recalcula a competência a partir do fechamento do método + data da compra.
 * Não sobrescreve se o usuário já editou o campo manualmente.
 */
function recalcularCompetencia() {
    const campo = document.getElementById('competencia');
    if (!campo || campo.dataset.editado) return;

    const iso = dataCampoParaISO(document.querySelector(SELECTORS.data).value);
    if (!iso) {
        // Sem data ainda: assume o mês vigente (usuário pode editar)
        if (typeof estadoApp !== 'undefined' && estadoApp.mesAtual) {
            campo.value = mesDeCompetencia(formatarDataISO(estadoApp.mesAtual));
        }
        return;
    }

    const metodo = typeof metodoSelecionado === 'function' ? metodoSelecionado() : null;
    const fech = metodo && metodo.metodoKind === 'Crédito' ? metodo.diaFechamento : null;
    campo.value = mesDeCompetencia(competenciaDe(iso, fech));
}

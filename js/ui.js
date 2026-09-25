/**
 * INTERFACE DO USUÁRIO
 * Renderização e atualização do DOM
 */

/** "58,3" em vez de "58" — 1 casa decimal (vírgula, pt-BR) nos percentuais
 *  dos gráficos/listas agrupadas; sem isso um grupo pequeno (ex. 0,4%)
 *  aparecia arredondado pra "0%", sem dar pra saber que ele tinha algo. */
function formatarPct(pct) {
    // Inteiro exato (ex.: 100,0) mostra sem casa decimal: "100"
    if (Math.abs(pct - Math.round(pct)) < 0.05) return String(Math.round(pct));
    return pct.toFixed(1).replace('.', ',');
}

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
    atualizarBuscaGlobal();

    // "Próximas" acompanha o mês em exibição
    if (document.getElementById('proximas')?.classList.contains('active')) {
        atualizarProximasTransacoes();
    }
}

// Tamanhos possíveis da janela (sempre ímpar/simétrico: N pra trás, atual, N
// pra frente) x formato do rótulo, do mais largo pro mais estreito. Encolhe
// 7 -> 5 -> 3 (tricode "SET"); se ainda não couber, troca pro número do mês
// ("9") em vez de encolher a janela pra 1 só — no pior caso extremo (3
// números) já é bem mais compacto que 1 tricode, então só cai pra 1 número
// se nem isso couber.
const TAMANHOS_JANELA_MESES = [
    { tamanho: 7, numerico: false },
    { tamanho: 5, numerico: false },
    { tamanho: 3, numerico: false },
    { tamanho: 3, numerico: true },
    { tamanho: 1, numerico: true }
];

/**
 * (Re)desenha a tira de meses + o ano no calendário do topo, tudo numa
 * linha só. Sempre mostra uma janela simétrica (3 antes + atual + 3 depois,
 * no máximo) em volta do mês SELECIONADO, com setas laterais pra navegar os
 * meses escondidos sem mudar a seleção — a janela só encolhe (7 -> 5 -> 3 ->
 * 1) até caber na largura disponível, e pode atravessar a virada do ano
 * (ex.: NOV DEZ JAN FEV). O ano mostrado ao lado é sempre o vigente (fixo,
 * sem setas); mês de um ano diferente do vigente leva o sufixo "/AA" — os
 * meses do ano vigente nunca levam sufixo. Não depende de dados carregados
 * — seguro de chamar em qualquer resize.
 */
function atualizarCalendarioNav() {
    const lista = document.getElementById('mesesLista');
    const anoLabel = document.getElementById('anoAtualLabel');
    if (!lista || typeof estadoApp === 'undefined' || !estadoApp.mesAtual) return;

    const hoje = new Date();
    const anoVigente = hoje.getFullYear();
    const absDe = (ano, mes) => ano * 12 + mes;
    const absHoje = absDe(anoVigente, hoje.getMonth());
    const anoSelecionado = estadoApp.mesAtual.getFullYear();
    const mesSelecionado = estadoApp.mesAtual.getMonth();
    const absSelecionado = absDe(anoSelecionado, mesSelecionado);
    const absCentro = absSelecionado;

    if (anoLabel) anoLabel.textContent = String(anoVigente);

    const montarBtn = (abs, numerico) => {
        const ano = Math.floor(abs / 12);
        const mes = ((abs % 12) + 12) % 12;
        const selecionado = abs === absSelecionado;
        const ehHoje = abs === absHoje;
        const classes = ['mes-btn', numerico && 'numerico', selecionado && 'selecionado', ehHoje && 'hoje'].filter(Boolean).join(' ');
        const rotulo = numerico
            ? String(mes + 1)
            : MESES_TRI[mes] + (ano === anoVigente ? '' : '/' + String(ano).slice(-2));
        return `<button type="button" class="${classes}" data-ano="${ano}" data-mes="${mes}" data-abs="${abs}">${rotulo}</button>`;
    };

    const idxsDaJanela = tamanho => {
        const k = (tamanho - 1) / 2;
        const idxs = [];
        for (let a = absCentro - k; a <= absCentro + k; a++) idxs.push(a);
        return idxs;
    };

    const renderJanela = (idxs, numerico) => { lista.innerHTML = idxs.map(a => montarBtn(a, numerico)).join(''); };

    renderJanela(idxsDaJanela(TAMANHOS_JANELA_MESES[0].tamanho), TAMANHOS_JANELA_MESES[0].numerico);

    // Mede depois do layout: se estourou, encolhe a janela (e depois troca
    // pro rótulo numérico) até caber.
    requestAnimationFrame(() => {
        let idxsFinal = idxsDaJanela(TAMANHOS_JANELA_MESES[0].tamanho);
        for (let i = 1; i < TAMANHOS_JANELA_MESES.length && lista.scrollWidth > lista.clientWidth + 1; i++) {
            const passo = TAMANHOS_JANELA_MESES[i];
            idxsFinal = idxsDaJanela(passo.tamanho);
            renderJanela(idxsFinal, passo.numerico);
        }
        _carregarIndicadoresJanela(idxsFinal);
    });
}

/** Busca (assíncrono, não trava o render) se cada mês da janela tem
 *  lançamento já acontecido (bolinha preenchida) ou a confirmar/futuro
 *  (só o contorno), e pinta a bolinha certa em cada botão visível. */
async function _carregarIndicadoresJanela(idxsAbs) {
    if (!idxsAbs || !idxsAbs.length || typeof carregarIndicadoresMeses !== 'function') return;
    const anoDe = abs => Math.floor(abs / 12);
    const mesDe = abs => ((abs % 12) + 12) % 12;
    const iniISO = `${anoDe(idxsAbs[0])}-${String(mesDe(idxsAbs[0]) + 1).padStart(2, '0')}-01`;
    const ultimo = idxsAbs[idxsAbs.length - 1];
    const anoFim = mesDe(ultimo) === 11 ? anoDe(ultimo) + 1 : anoDe(ultimo);
    const mesFim = (mesDe(ultimo) + 1) % 12;
    const fimISO = `${anoFim}-${String(mesFim + 1).padStart(2, '0')}-01`;

    const porMes = await carregarIndicadoresMeses(iniISO, fimISO);
    const lista = document.getElementById('mesesLista');
    if (!lista) return;
    idxsAbs.forEach(abs => {
        const chave = `${anoDe(abs)}-${String(mesDe(abs) + 1).padStart(2, '0')}`;
        const info = porMes[chave];
        if (!info) return;
        const btn = lista.querySelector(`.mes-btn[data-abs="${abs}"]`);
        if (!btn || btn.querySelector('.mes-dot')) return;
        const dot = document.createElement('span');
        dot.className = 'mes-dot' + (info.passado ? '' : ' contorno');
        btn.appendChild(dot);
    });
}

/**
 * Reduz o font-size de `el` (a partir do tamanho definido no CSS) até o
 * conteúdo caber numa linha só, sem cortar — nunca usa "…": regra é sempre
 * diminuir a fonte até caber, em vez de truncar o texto.
 */
function ajustarFonteParaCaber(el, minPx = 10) {
    if (!el) return;
    el.style.fontSize = '';
    let tamanho = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(tamanho)) return;
    while (el.scrollWidth > el.clientWidth + 1 && tamanho > minPx) {
        tamanho -= 1;
        el.style.fontSize = tamanho + 'px';
    }
}

/** Elementos de valor que podem precisar encolher — reavaliados também no
 *  resize (a largura do card muda, então o que cabia pode deixar de caber). */
function ajustarFontesDashboard() {
    ['totalEntradas', 'totalSaidas', 'balanco', 'gastoDiario']
        .forEach(id => ajustarFonteParaCaber(document.getElementById(id)));
    // Balanço e Gasto diário lado a lado: mesmo tamanho (o menor dos dois)
    const par = ['balanco', 'gastoDiario'].map(id => document.getElementById(id)).filter(Boolean);
    if (par.length === 2) {
        const menor = Math.min(...par.map(el => parseFloat(getComputedStyle(el).fontSize)));
        par.forEach(el => { el.style.fontSize = menor + 'px'; });
    }
}

/**
 * Atualiza card de resumo
 */
function atualizarResumo() {
    const resumo = obterResumoFormatado();
    // "Olho" do cabeçalho (ver configurarOlhoValores em main.js) — esconde só
    // os NÚMEROS do dashboard, nada mais (listas, formulário etc. continuam
    // normais). Mascara depois de formatar, então o "R$" contextual some
    // junto — "••••" sozinho já deixa claro que é um valor escondido.
    const mask = s => (typeof valoresOcultos !== 'undefined' && valoresOcultos) ? '••••' : s;

    const totalEntradasEl = document.querySelector(SELECTORS.totalEntradas);
    const totalSaidasEl = document.querySelector(SELECTORS.totalSaidas);
    const balancoEl = document.querySelector(SELECTORS.balanco);

    if (totalEntradasEl) totalEntradasEl.textContent = mask(resumo.entradas);
    if (totalSaidasEl) totalSaidasEl.textContent = mask(resumo.saidas);

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = mask(formatarMoeda(v || 0)); };
    setTxt('entradasAtual', estadoApp.resumo.entradasAtual);
    setTxt('entradasAReceber', estadoApp.resumo.entradasAReceber);
    setTxt('saidasAtual', estadoApp.resumo.saidasAtual);
    setTxt('saidasAPagar', estadoApp.resumo.saidasAPagar);

    if (balancoEl) {
        balancoEl.textContent = mask(resumo.balanco);
        // Balanço sempre com a cor "balanço" (amarelo) — sem tema por saldo.
        const card = balancoEl.closest('.summary-card');
        if (card) card.style.cssText = '';
    }

    // Saldo real das contas bancárias conectadas (só aparece com conta conectada)
    const scEl = document.getElementById('saldoContas');
    if (scEl) {
        scEl.hidden = estadoApp.saldoContas == null;
        const scVal = document.getElementById('saldoContasValor');
        if (scVal && estadoApp.saldoContas != null) scVal.textContent = mask(formatarMoeda(estadoApp.saldoContas));
        // A faixa é um toggle que descortina o saldo de cada conta (empurrando o
        // resto pra baixo) — mesmo com uma conta só.
        const lista = estadoApp.saldoContasLista || [];
        const varias = lista.length > 0;
        scEl.classList.toggle('saldo-contas--toggle', varias);
        scEl.setAttribute('role', varias ? 'button' : 'note');
        scEl.tabIndex = varias ? 0 : -1;
        scEl.setAttribute('aria-expanded', String(varias && !!estadoApp.saldoContasAberto));
        const detalhe = document.getElementById('saldoContasLista');
        if (detalhe) {
            const aberto = varias && !!estadoApp.saldoContasAberto && estadoApp.saldoContas != null;
            detalhe.hidden = !aberto;
            detalhe.innerHTML = aberto
                ? lista.map(c => `<div class="sc-linha"><span>${c.nome}</span><b>${mask(formatarMoeda(c.saldo))}</b></div>`).join('')
                : '';
        }
    }

    // Gasto diário = balanço / dias restantes do mês vigente
    const gd = document.getElementById('gastoDiario');
    const gdSub = document.getElementById('gastoDiarioSub');
    const dias = diasRestantesMesVigente();
    const gastoDiarioValor = dias > 0 ? (estadoApp.resumo.balanco || 0) / dias : 0;
    if (gd) {
        gd.textContent = mask(formatarMoeda(gastoDiarioValor));
        if (gdSub) gdSub.textContent = `${dias} dia${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}`;
    }

    // Espelha os totais no resumo compacto (barra fixa) — com "R$", sem centavos ",00"
    const setMini = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = mask(formatarMoeda(v || 0)); };
    setMini('miniEntradas', estadoApp.resumo.entradas);
    setMini('miniSaidas', estadoApp.resumo.saidas);
    setMini('miniBalanco', estadoApp.resumo.balanco);
    setMini('miniGasto', gastoDiarioValor);

    _atualizarAvisoDuplicatas();

    // Depois do texto assentado (e do layout dos cards, que só é conhecido
    // após o DOM aplicar), reavalia se algum valor precisa encolher.
    requestAnimationFrame(ajustarFontesDashboard);
}

/** Aviso "⚠️ Duplicatas" no card de Receita/Despesa do dashboard, só quando
 *  aquele mês tem alguma duplicata suspeita (mesma detecção do grupo da
 *  lista). Clicável — ver abrirGrupoDuplicatas(). Some o texto e deixa só o
 *  emoji se não couber (medido depois do layout aplicar, como
 *  definirLabelResp já faz noutros lugares do form). */
function _atualizarAvisoDuplicatas() {
    ['entrada', 'saida'].forEach(tipoUI => {
        const badge = document.querySelector(`.dup-aviso[data-dup-aviso="${tipoUI}"]`);
        if (!badge) return;
        const lista = tipoUI === 'entrada' ? estadoApp.transacoes.entradas : estadoApp.transacoes.saidas;
        const temDuplicata = _detectarDuplicatas(lista).length > 0;
        badge.hidden = !temDuplicata;
        if (!temDuplicata) return;
        badge.textContent = '⚠️ Duplicatas';
        requestAnimationFrame(() => {
            const h3 = badge.closest('h3');
            if (h3 && h3.scrollWidth > h3.clientWidth + 1) badge.textContent = '⚠️';
        });
    });
}

// Força o grupo de duplicatas a abrir no próximo render dessa lista — único
// jeito de abrir sozinho (todo o resto começa fechado). Usado só pelo clique
// no aviso do dashboard; reseta sozinho depois de 1 render.
const _forcarAbrirDuplicatas = { entrada: false, saida: false };

/** Clique no aviso "⚠️ Duplicatas" do dashboard: abre a aba (Receita/Despesa)
 *  já com o grupo de duplicatas expandido, sem precisar procurar/abrir na mão. */
function abrirGrupoDuplicatas(tipoUI) {
    const aba = tipoUI === 'entrada' ? 'entradas' : 'saidas';
    _forcarAbrirDuplicatas[tipoUI] = true;
    if (document.getElementById(aba)?.classList.contains('active')) {
        if (tipoUI === 'entrada') atualizarEntradasLista(); else atualizarSaidasLista();
    } else if (typeof mudarAba === 'function') {
        mudarAba(aba);
    }
}

/** Dias restantes do mês EXIBIDO (estadoApp.mesAtual), incluindo hoje.
 *  Mês atual de verdade: contagem regressiva normal (mínimo 1).
 *  Mês passado: 0 (acabou, sem gasto diário nem contagem).
 *  Mês futuro: travado no total de dias do mês, até chegar nele. */
function diasRestantesMesVigente() {
    const hoje = new Date();
    const mesRef = estadoApp.mesAtual || hoje;
    const totalDias = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0).getDate();

    if (mesRef.getFullYear() === hoje.getFullYear() && mesRef.getMonth() === hoje.getMonth()) {
        return Math.max(1, totalDias - hoje.getDate() + 1);
    }
    const ehPassado = mesRef.getFullYear() < hoje.getFullYear()
        || (mesRef.getFullYear() === hoje.getFullYear() && mesRef.getMonth() < hoje.getMonth());
    return ehPassado ? 0 : totalDias;
}

/** Lê de localStorage o modo salvo pra essa lista, validando contra as opções atuais. */
function _modoListaSalvo(chave, validos) {
    try {
        const salvo = localStorage.getItem(chave);
        return validos.includes(salvo) ? salvo : 'cronologica';
    } catch (_) { return 'cronologica'; }
}

// Filtro de grupo da barra proporcional, um por combinação modo+tipo (um
// filtro escolhido em "Por método" não deve valer se o usuário for pra
// "Por categoria"). null = mostra tudo. Só usado pelos modos QUE NÃO SÃO
// Cronológica (essa já mostra os 2 grupos lado a lado, com o clique
// abrindo/fechando em vez de filtrar).
const _filtrosGrupoBarra = {};
const _filtroGrupoDe = (tipoUI, modo) => _filtrosGrupoBarra[`${tipoUI}:${modo}`] || null;
const _setFiltroGrupoBarra = (tipoUI, modo, valor) => { _filtrosGrupoBarra[`${tipoUI}:${modo}`] = valor; };

/** Agrupa `transacoes` pela MESMA dimensão que o modo de visualização usa
 *  (método/categoria) — usado só pra montar a barra proporcional com as
 *  cores/nomes certos; a lista embaixo continua sendo agrupada pelas
 *  funções renderListaPorMetodo/PorCategoria como sempre. */
function _agruparParaBarra(modo, transacoes, tipoUI) {
    const cores = (estadoApp.menus && estadoApp.menus.cores) || {};
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;
    let chaveDe, semChave, corMapa, rotuloDe = k => k;
    if (modo === 'metodo') {
        chaveDe = t => t.metodo; semChave = 'Sem método'; corMapa = cores.metodo || {};
    } else {
        chaveDe = t => t.categoria; semChave = 'Sem categoria'; corMapa = cores.categoria || {};
    }
    const mapa = new Map();
    transacoes.forEach(t => {
        const k = chaveDe(t) || semChave;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(t);
    });
    const grupos = [...mapa.entries()]
        .map(([chave, itens]) => ({
            chave,
            nome: rotuloDe(chave),
            cor: corMapa[chave] || corPadraoChip(chave),
            total: itens.reduce((s, t) => s + valorDe(t), 0)
        }))
        .sort((a, b) => b.total - a.total);
    return { grupos, chaveDe, semChave };
}

/** Barra proporcional com 1 segmento por grupo da dimensão do modo atual
 *  (Por recorrência/método/categoria — Cronológica tem a sua própria,
 *  embutida em renderListaCronologica). Clique num segmento filtra a lista
 *  pra só aquele grupo; clicar de novo no mesmo volta a mostrar tudo. */
function _renderBarraGrupos(grupos, tipoUI, modo) {
    const totalGeral = grupos.reduce((s, g) => s + g.total, 0);
    if (!totalGeral) return '';
    const filtro = _filtroGrupoDe(tipoUI, modo);
    const segs = grupos.map(g => {
        const pct = (g.total / totalGeral) * 100;
        const apagado = filtro && filtro !== g.chave ? ' cron-barra-seg--apagado' : '';
        const chaveAttr = String(g.chave).replace(/"/g, '&quot;');
        return `<button type="button" class="cron-barra-seg${apagado}" data-grupo-toggle="${chaveAttr}"
                  style="--cor-rec:${g.cor}; flex-grow:${Math.max(pct, g.total ? 2 : 0)}"
                  title="${g.nome}: ${formatarPct(pct)}% · ${formatarMoeda(g.total)}" ${g.total ? '' : 'hidden'}></button>`;
    }).join('');
    return `<div class="cron-barra" role="img">${segs}</div>`;
}

/** IDs de transação que o usuário já confirmou "não é duplicata" — persiste
 *  no localStorage (por navegador/dispositivo) pra não voltar a incomodar
 *  com o mesmo lançamento depois de resolvido. */
function _duplicatasAprovadasSet() {
    try { return new Set(JSON.parse(localStorage.getItem('duplicatasAprovadas') || '[]')); }
    catch (_) { return new Set(); }
}
function _aprovarDuplicata(id) {
    const s = _duplicatasAprovadasSet();
    s.add(id);
    try { localStorage.setItem('duplicatasAprovadas', JSON.stringify([...s])); } catch (_) {}
}

/** Duplicata suspeita: mesmo valor, método e descrição (normalizada)
 *  aparecendo mais de uma vez no mês exibido — mesmo se a data for
 *  diferente (foi assim que os bugs de importação/reimportação desta
 *  sessão geraram duplicata real: a competência batia — por isso as duas
 *  apareciam juntas no mesmo mês — só a data é que ficava errada). Ignora
 *  transações já aprovadas ("não é duplicata mesmo"). */
function _detectarDuplicatas(transacoes) {
    const aprovadas = _duplicatasAprovadasSet();
    const mapa = new Map();
    (transacoes || []).forEach(t => {
        const chave = [t.valor, t.metodo || '', _normalizarChave(t.descricao || '')].join('|');
        if (!mapa.has(chave)) mapa.set(chave, []);
        mapa.get(chave).push(t);
    });
    // O par precisa ter >=2 membros ANTES de tirar os aprovados — aprovar 1
    // dos 2 não pode fazer o outro (ainda não aprovado) sumir também.
    return [...mapa.values()].filter(g => g.length >= 2)
        .flatMap(g => g.filter(t => !aprovadas.has(t.id))).sort(_porDataDesc);
}

/** Grupo "Verificação de duplicatas" fixo no topo da lista, em qualquer
 *  modo de visualização (não é uma dimensão de análise como método/
 *  categoria — é sobre consistência dos dados, então não faz sentido
 *  esconder num modo só). Cada item tem um botão "✓" — se for mesmo outro
 *  lançamento (ex.: sessões de terapia em dias diferentes, 2 compras
 *  parecidas em dias seguidos), aprovar tira ele da lista pra sempre. Some
 *  sozinho conforme o usuário for resolvendo (editando, apagando ou
 *  aprovando) — não precisa "arquivar". Grupo vazio nunca abre (nem é
 *  clicável: não é um <details>, é uma linha estática). */
function _renderGrupoDuplicatas(transacoes, tipoUI, aberto) {
    const duplicatas = _detectarDuplicatas(transacoes);
    // Sem duplicata nenhuma: nada pra mostrar — some o grupo inteiro em vez
    // de deixar uma caixa vazia "🎉 Sem duplicatas" ocupando espaço à toa.
    if (!duplicatas.length) return '';
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;
    const total = duplicatas.reduce((s, t) => s + valorDe(t), 0);
    return `
    <details class="rec-grupo" data-nome="__duplicatas__" style="--cor-rec:var(--despesa-text)" ${aberto ? 'open' : ''}>
      <summary>
        <span class="rec-grupo-nome">🔁 Duplicatas</span>
        <span role="button" tabindex="0" class="mini-btn" data-dup-aceitar-todas title="Marca todas como &quot;não é duplicata&quot; — não avisa de novo sobre elas">✓ Aceitar todas</span>
        <span role="button" tabindex="0" class="mini-btn armed" data-dup-apagar-todas title="Apaga todos os lançamentos listados aqui">🗑 Apagar todas</span>
        <span class="rec-grupo-espaco"></span>
        <span class="rec-grupo-contagem">${duplicatas.length}</span>
        <span class="rec-grupo-total">${formatarMoeda(total)}</span>
      </summary>
      <div class="rec-grupo-itens">
        ${duplicatas.map(t => gerarHTMLTransacao(t, tipoUI, { comAprovarDuplicata: true })).join('')}
      </div>
    </details>`;
}

/** Escolhe a renderização certa pro modo de visualização selecionado — usado
 *  tanto por Receitas quanto por Despesas. Nos modos que não são
 *  Cronológica, prepend uma barra com 1 segmento por grupo (recorrência/
 *  método/categoria, conforme o modo) cujo clique filtra a lista pra só
 *  aquele grupo (Cronológica já tem sua própria barra + grupos abrindo/
 *  fechando, em vez de filtrar). O grupo "Duplicatas" vem sempre no topo
 *  de VERDADE — num container fixo próprio, ACIMA dos filtros (modo-lista),
 *  não dentro da lista — ver #duplicatasEntradas/#duplicatasSaidas. */
function renderListaPorModo(container, transacoes, tipoUI, modo, msgVazia) {
    if (!container) return;
    const dupContainer = document.getElementById(tipoUI === 'entrada' ? 'duplicatasEntradas' : 'duplicatasSaidas');
    let abertoDuplicatas = dupContainer?.querySelector('details.rec-grupo[data-nome="__duplicatas__"]')?.open;
    if (_forcarAbrirDuplicatas[tipoUI]) {
        abertoDuplicatas = true;
        _forcarAbrirDuplicatas[tipoUI] = false;
    }

    if (modo === 'cronologica') {
        renderListaCronologica(container, transacoes, tipoUI, msgVazia);
    } else if (!transacoes || !transacoes.length) {
        container.innerHTML = `<p class="empty-message">${msgVazia}</p>`;
        container.onclick = null;
    } else {
        const { grupos, chaveDe, semChave } = _agruparParaBarra(modo, transacoes, tipoUI);
        const barraHTML = _renderBarraGrupos(grupos, tipoUI, modo);
        const filtro = _filtroGrupoDe(tipoUI, modo);
        const filtrados = filtro ? transacoes.filter(t => (chaveDe(t) || semChave) === filtro) : transacoes;
        const grupoAtivo = grupos.find(g => g.chave === filtro);
        const msgFiltrado = grupoAtivo ? `Nada em "${grupoAtivo.nome}"` : msgVazia;

        if (modo === 'metodo') {
            renderListaPorMetodo(container, filtrados, tipoUI, msgFiltrado);
        } else {
            renderListaPorCategoria(container, filtrados, tipoUI, msgFiltrado);
        }

        container.insertAdjacentHTML('afterbegin', barraHTML);
        const onClickConteudo = container.onclick;
        container.onclick = e => {
            const seg = e.target.closest('[data-grupo-toggle]');
            if (seg) {
                const valor = seg.dataset.grupoToggle;
                _setFiltroGrupoBarra(tipoUI, modo, filtro === valor ? null : valor);
                renderListaPorModo(container, transacoes, tipoUI, modo, msgVazia);
                return;
            }
            const subBtn = e.target.closest('[data-submodo]');
            if (subBtn) {
                e.preventDefault(); // está dentro do <summary> — sem isso, o clique também abre/fecha o <details>
                const grupoChave = subBtn.closest('[data-grupo-chave]').dataset.grupoChave;
                const atual = _subModoGrupoDe(tipoUI, modo, grupoChave);
                const novo = subBtn.dataset.submodo === atual ? 'cronologica' : subBtn.dataset.submodo;
                _setSubModoGrupo(tipoUI, modo, grupoChave, novo);
                // Clicar no filtro já abre o grupo — não faz sentido escolher
                // "por categoria" e continuar vendo o grupo fechado.
                const det = subBtn.closest('details.rec-grupo');
                if (det) det.open = true;
                renderListaPorModo(container, transacoes, tipoUI, modo, msgVazia);
                return;
            }
            const subIcone = e.target.closest('[data-submodo-icone]');
            if (subIcone) {
                e.preventDefault();
                const grupoChave = subIcone.closest('[data-grupo-chave]').dataset.grupoChave;
                _setSubModoGrupo(tipoUI, modo, grupoChave, 'cronologica');
                renderListaPorModo(container, transacoes, tipoUI, modo, msgVazia);
                return;
            }
            const ordemBtn = e.target.closest('[data-ordem-criacao-toggle]');
            if (ordemBtn) {
                e.preventDefault(); // está dentro do <summary> — sem isso, o clique também abre/fecha o <details>
                const chave = ordemBtn.dataset.ordemCriacaoToggle;
                _ordemCriacaoGrupo[chave] = !_ordemCriacaoGrupo[chave];
                // Sobe pro <details> mais próximo (subgrupo, se o clique foi
                // num subgrupo; senão o rec-grupo de fora) — sempre abre.
                const det = ordemBtn.closest('details.subgrupo, details.rec-grupo');
                if (det) det.open = true;
                renderListaPorModo(container, transacoes, tipoUI, modo, msgVazia);
                return;
            }
            if (onClickConteudo) onClickConteudo(e);
        };
    }

    if (dupContainer) {
        dupContainer.innerHTML = (transacoes && transacoes.length)
            ? _renderGrupoDuplicatas(transacoes, tipoUI, abertoDuplicatas) : '';
        dupContainer.onclick = onListaTransacaoClick;
    }
}

// 'categoria' | 'cronologica' (padrão) — visão da aba Receitas
const MODOS_LISTA_ENTRADAS = ['cronologica', 'categoria'];
let modoListaEntradas = _modoListaSalvo('modoListaEntradas', MODOS_LISTA_ENTRADAS);

function definirModoListaEntradas(modo) {
    // Toggle: clicar de novo no filtro já ativo desliga (volta pra
    // cronológica) — não tem botão "Cronológica" próprio, é só o "nenhum
    // filtro ligado".
    const novo = modo === modoListaEntradas ? 'cronologica' : modo;
    modoListaEntradas = MODOS_LISTA_ENTRADAS.includes(novo) ? novo : 'cronologica';
    try { localStorage.setItem('modoListaEntradas', modoListaEntradas); } catch (_) {}
    atualizarEntradasLista();
}

/** Sempre que Receita/Despesa/Próximas fecham ou abrem, o filtro volta pro
 *  padrão (Cronológica) em vez de manter o modo da última vez que a aba
 *  esteve aberta. */
function resetarModosListaParaCronologica() {
    modoListaEntradas = 'cronologica';
    modoListaSaidas = 'cronologica';
    modoListaProximas = 'cronologica';
    try {
        localStorage.setItem('modoListaEntradas', 'cronologica');
        localStorage.setItem('modoListaSaidas', 'cronologica');
        localStorage.setItem('modoListaProximas', 'cronologica');
    } catch (_) {}
}

/** Busca em tempo real por descrição/categoria/forma de pagamento — filtra
 *  ANTES de passar pro modo de visualização escolhido, então funciona
 *  igual em qualquer modo (Cronológica/Recorrência/Forma de pgto./
 *  Categoria) sem precisar mexer em cada um deles. */

const _REGEX_DIACRITICOS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function _normalizarBusca(s) {
    return String(s || '').normalize('NFD').replace(_REGEX_DIACRITICOS, '').toLowerCase();
}

function _filtrarPorBusca(transacoes, termo) {
    const t = _normalizarBusca(termo).trim();
    if (!t) return transacoes;
    return (transacoes || []).filter(tr => {
        const bateTexto = [tr.descricao, tr.categoria, tr.metodo, tr.formaPagamento]
            .some(campo => _normalizarBusca(campo).includes(t));
        if (bateTexto) return true;
        // Valor: aceita tanto formatado ("r$ 50,00") quanto número solto
        // ("50" ou "50,5") — sem isso, buscar por valor não achava nada.
        const valor = (tr.valorMes != null ? tr.valorMes : tr.valor) || 0;
        const valorFormatado = _normalizarBusca(formatarMoeda(valor));
        const valorSolto = String(valor).replace('.', ',');
        return valorFormatado.includes(t) || valorSolto.includes(t);
    });
}

/** Itens que a aba Próximos mostraria (A receber / A pagar sem cartão + tudo
 *  do cartão de crédito no mês) que batem com o termo. */
function _itensProximosBusca(termo) {
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const credito = new Set(metodos.filter(m => m.metodoKind === 'Crédito').map(m => rotuloMetodo(m)));
    const todos = [...(estadoApp.transacoes.entradas || []), ...(estadoApp.transacoes.saidas || [])];
    // Só o que AINDA não aconteceu (vencimento/pagamento não passou) — o que já
    // aconteceu aparece só em Receitas/Despesas, nunca nos dois grupos.
    return _filtrarPorBusca(todos, termo).filter(t => !_transacaoRealizada(t));
}

/** Busca UNIVERSAL: um campo só, de qualquer tela. Com termo, esconde o
 *  conteúdo da aba atual e mostra o resultado agrupado em Receitas / Despesas
 *  / Próximos (o mesmo lançamento pode aparecer em mais de um grupo — cada
 *  grupo espelha a sua aba). Sem termo, volta tudo como estava. */
function atualizarBuscaGlobal() {
    const termo = (document.getElementById('buscaGlobal')?.value || '').trim();
    const box = document.getElementById('resultadoBusca');
    document.body.classList.toggle('buscando', !!termo);
    if (!box) return;
    box.hidden = !termo;
    if (!termo) { box.innerHTML = ''; box.onclick = null; return; }

    const abertos = _lerAbertosRecGrupo(box);
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;
    // Cada lançamento aparece em UM grupo só: já aconteceu -> Receitas/Despesas;
    // ainda não venceu/foi pago -> Próximos.
    const receitas = _filtrarPorBusca(estadoApp.transacoes.entradas, termo).filter(_transacaoRealizada).sort(_porDataDesc);
    const despesas = _filtrarPorBusca(estadoApp.transacoes.saidas, termo).filter(_transacaoRealizada).sort(_porDataDesc);
    const proximosItens = _itensProximosBusca(termo);
    const pendentesHTML = renderPendentesProximas({}, termo);
    const faturasHTML = renderFaturasCartao(null, termo, true);

    const grupo = (nome, titulo, cor, qtd, total, corpo) => !qtd ? '' : `
    <details class="rec-grupo" data-nome="${nome}" style="--cor-rec:${cor}" ${abertos[nome] !== false ? 'open' : ''}>
      <summary>
        <span class="rec-grupo-nome">${titulo}</span>
        <span class="rec-grupo-contagem">${qtd}</span>
        <span class="rec-grupo-total">${formatarMoeda(total)}</span>
      </summary>
      <div class="rec-grupo-itens">${corpo}</div>
    </details>`;

    const html =
        grupo('__busca_receitas__', '⬇️ Receitas', 'var(--receita-text)', receitas.length,
            receitas.reduce((s, t) => s + valorDe(t), 0), receitas.map(t => gerarHTMLTransacao(t, 'entrada')).join('')) +
        grupo('__busca_despesas__', '⬆️ Despesas', 'var(--despesa-text)', despesas.length,
            despesas.reduce((s, t) => s + valorDe(t), 0), despesas.map(t => gerarHTMLTransacao(t, 'saida')).join('')) +
        grupo('__busca_proximos__', '⏰ Próximos', 'var(--primary)', proximosItens.length,
            proximosItens.reduce((s, t) => s + (t.tipo === 'entradas' ? -valorDe(t) : valorDe(t)), 0),
            pendentesHTML + (faturasHTML || ''));

    box.innerHTML = html;
    // Cliques: itens da lixeira (restaurar/apagar) ou o resto (editar, excluir, faturas...)
    box.onclick = e => (e.target.closest('[data-lixeira-restaurar], [data-lixeira-apagar]')
        ? onCliqueLixeira(e) : _onCliqueProximas(e));

    // A lixeira (excluídos nos últimos 30 dias) também entra na busca — vem
    // depois, de forma assíncrona; só aplica se o termo ainda for o mesmo.
    const vazio = () => `<div class="rec-grupo rec-grupo--vazio"><span class="rec-grupo-nome">🔎 Nada encontrado pra "${termo}"</span></div>`;
    if (typeof buscarLixeira !== 'function') { if (!html) box.innerHTML = vazio(); return; }
    buscarLixeira(termo).then(itens => {
        if ((document.getElementById('buscaGlobal')?.value || '').trim() !== termo) return;
        if (!itens.length) { if (!html) box.innerHTML = vazio(); return; }
        const total = itens.reduce((s, i) => s + (Number((i.dados || {}).valor) || 0), 0);
        box.innerHTML = html + `
        <details class="rec-grupo" data-nome="__busca_lixeira__" style="--cor-rec:var(--text-muted)" ${abertos.__busca_lixeira__ !== false ? 'open' : ''}>
          <summary>
            <span class="rec-grupo-nome">🗑️ Lixeira</span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total">${formatarMoeda(total)}</span>
          </summary>
          <div class="rec-grupo-itens">${itens.map(htmlItemLixeira).join('')}</div>
        </details>`;
    });
}

function atualizarEntradasLista() {
    document.querySelectorAll('#modoEntradas .modo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.modo === modoListaEntradas));
    document.getElementById('modoEntradas')?.classList.toggle('vazio', !estadoApp.transacoes.entradas.length);
    document.getElementById('modoEntradasIcone')?.classList.toggle('ativo', modoListaEntradas !== 'cronologica');
    _ajustarLabelsFiltro(document.getElementById('modoEntradas'));
    const container = document.querySelector(SELECTORS.entradasLista);
    renderListaPorModo(container, estadoApp.transacoes.entradas, 'entrada', modoListaEntradas, 'Nenhuma receita neste mês');
}

// 'metodo' | 'categoria' | 'cronologica' (padrão) — visão da aba Despesas
const MODOS_LISTA_SAIDAS = ['cronologica', 'metodo', 'categoria'];
let modoListaSaidas = _modoListaSalvo('modoListaSaidas', MODOS_LISTA_SAIDAS);

function definirModoListaSaidas(modo) {
    // Toggle: clicar de novo no filtro já ativo desliga (volta pra cronológica).
    const novo = modo === modoListaSaidas ? 'cronologica' : modo;
    modoListaSaidas = MODOS_LISTA_SAIDAS.includes(novo) ? novo : 'cronologica';
    try { localStorage.setItem('modoListaSaidas', modoListaSaidas); } catch (_) {}
    atualizarSaidasLista();
}

function atualizarSaidasLista() {
    document.querySelectorAll('#modoSaidas .modo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.modo === modoListaSaidas));
    document.getElementById('modoSaidas')?.classList.toggle('vazio', !estadoApp.transacoes.saidas.length);
    document.getElementById('modoSaidasIcone')?.classList.toggle('ativo', modoListaSaidas !== 'cronologica');
    _ajustarLabelsFiltro(document.getElementById('modoSaidas'));
    const container = document.querySelector(SELECTORS.saidasLista);
    renderListaPorModo(container, estadoApp.transacoes.saidas, 'saida', modoListaSaidas, 'Nenhuma despesa neste mês');
}

/** Agrupa e renderiza `transacoes` por `chaveDe(t)`, ordenado por total (maior primeiro).
 *  Usado por "Por método" e "Por categoria" — mesmo formato de card recolhível,
 *  com o mesmo organizador inline (outras 2 dimensões) que "Por recorrência" tem. */
function _renderListaAgrupadaPorTotal(container, transacoes, tipoUI, msgVazia, { chaveDe, semChave, cores, gerarOpts, modo }) {
    if (!container) return;
    if (!transacoes || !transacoes.length) {
        container.innerHTML = `<p class="empty-message">${msgVazia}</p>`;
        container.onclick = null;
        return;
    }
    const ehDespesa = tipoUI === 'saida';
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;

    const mapa = new Map();
    transacoes.forEach(t => {
        const k = chaveDe(t) || semChave;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(t);
    });
    const grupos = [...mapa.entries()]
        .map(([nome, itens]) => [nome, _ordenarPorGrupo(itens, `${tipoUI}:${modo}:${nome}`), itens.reduce((s, t) => s + valorDe(t), 0)])
        .sort((a, b) => b[2] - a[2]);

    const totalGeral = grupos.reduce((s, g) => s + g[2], 0);
    const abertos = _lerAbertosRecGrupo(container);
    const abertosSub = _lerAbertosSubgrupo(container);

    container.innerHTML = grupos.map(([nome, itens, total]) => {
        const c = cores[nome] || corPadraoChip(nome);
        const pct = totalGeral ? (total / totalGeral) * 100 : 0;
        const corpoItens = _corpoGrupoComSubmodo(itens, tipoUI, modo, nome, ehDespesa, abertosSub, gerarOpts);
        const submenuHTML = _renderOrganizadorInline(tipoUI, modo, nome, ehDespesa);
        const ordemCriacaoHTML = _renderOrdemCriacaoToggle(`${tipoUI}:${modo}:${nome}`);
        return `
        <details class="rec-grupo" data-nome="${String(nome).replace(/"/g, '&quot;')}" style="--cor-rec:${c}" ${abertos[nome] ? 'open' : ''}>
          <summary>
            <span class="rec-grupo-nome">${nome}</span>
            <span class="rec-grupo-espaco"></span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total"><span class="tot-valor">${formatarMoeda(total)}</span>${totalGeral ? `<span class="tot-pct"><i class="tot-sep"> · </i>${formatarPct(pct)}%</span>` : ''}</span>
          </summary>
          <div class="rec-grupo-itens">
            ${_barraGrupo(ordemCriacaoHTML + submenuHTML)}
            ${corpoItens}
          </div>
        </details>`;
    }).join('');

    container.querySelectorAll('.subgrupo-organizador').forEach(_ajustarLabelsFiltro);
    container.onclick = onListaTransacaoClick;
}

/** Transações agrupadas por método de pagamento, ordenadas por total (maior primeiro) */
function renderListaPorMetodo(container, transacoes, tipoUI, msgVazia) {
    const cores = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.metodo) || {};
    _renderListaAgrupadaPorTotal(container, transacoes, tipoUI, msgVazia, {
        chaveDe: t => t.metodo,
        semChave: 'Sem forma de pagamento',
        cores,
        gerarOpts: { semMetodoChip: true },
        modo: 'metodo'
    });
}

/** Transações agrupadas por categoria, ordenadas por total (maior primeiro) */
function renderListaPorCategoria(container, transacoes, tipoUI, msgVazia) {
    const cores = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.categoria) || {};
    _renderListaAgrupadaPorTotal(container, transacoes, tipoUI, msgVazia, {
        chaveDe: t => t.categoria,
        semChave: 'Sem categoria',
        cores,
        gerarOpts: { semCategoriaChip: true },
        modo: 'categoria'
    });
}

/** Mesma regra usada no card de resumo (calcularResumoMes, data.js) pra
 *  decidir se uma transação já "aconteceu" (Atual) ou ainda está pendente
 *  (A receber / A pagar) — cartão de crédito só "realiza" depois que o
 *  vencimento da fatura daquela competência já passou. */
function _transacaoRealizada(t) {
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const cartao = metodos.find(m => m.metodoKind === 'Crédito'
        && (typeof rotuloMetodo === 'function' ? rotuloMetodo(m) : m.nome) === t.metodo);
    const hoje = new Date().toISOString().slice(0, 10);
    if (cartao) {
        const venc = (cartao.diaVencimento && t.competencia)
            ? dataVencimento(t.competencia, cartao.diaVencimento) : null;
        return !!(venc && venc < hoje);
    }
    return !t.pendente && String(t.data).slice(0, 10) < hoje;
}

/** "Cronológica": divide em 2 grupos (Atual / A receber ou A pagar), com
 *  uma barra horizontal única mostrando a proporção de cada um em cima —
 *  hover mostra %+valor, clique abre/fecha o grupo correspondente. */
function renderListaCronologica(container, transacoes, tipoUI, msgVazia) {
    if (!container) return;
    if (!transacoes || !transacoes.length) {
        container.innerHTML = `<p class="empty-message">${msgVazia}</p>`;
        container.onclick = null;
        return;
    }

    const rotuloPendente = tipoUI === 'entrada' ? 'A receber' : 'A pagar';
    const corAtual = tipoUI === 'entrada' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const corPendente = 'var(--balanco-text)';
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;

    const atuais = [], pendentes = [];
    transacoes.forEach(t => (_transacaoRealizada(t) ? atuais : pendentes).push(t));
    _ordenarPorGrupo(atuais, `${tipoUI}:cronologica:Atual`);
    _ordenarPorGrupo(pendentes, `${tipoUI}:cronologica:${rotuloPendente}`);

    const totalAtual = atuais.reduce((s, t) => s + valorDe(t), 0);
    const totalPendente = pendentes.reduce((s, t) => s + valorDe(t), 0);
    const totalGeral = totalAtual + totalPendente;
    const pctAtual = totalGeral ? (totalAtual / totalGeral) * 100 : 0;
    const pctPendente = totalGeral ? 100 - pctAtual : 0;

    const abertos = _lerAbertosRecGrupo(container);
    // Grupo vazio nunca abre — nem é clicável: sem <details>, é uma linha
    // estática (não tem nada pra mostrar, então não faz sentido nem deixar
    // "abrir" e ver "Nada aqui").
    const grupoHTML = (nome, cor, itens, total, pct) => {
        if (!itens.length) return `
        <div class="rec-grupo rec-grupo--vazio" style="--cor-rec:${cor}">
          <span class="rec-grupo-nome">${nome}</span>
          <span class="rec-grupo-espaco"></span>
          <span class="rec-grupo-contagem">0</span>
        </div>`;
        return `
        <details class="rec-grupo" data-nome="${nome}" style="--cor-rec:${cor}" ${abertos[nome] ? 'open' : ''}>
          <summary>
            <span class="rec-grupo-nome">${nome}</span>
            <span class="rec-grupo-espaco"></span>
            <span class="rec-grupo-contagem">${itens.length}</span>
            <span class="rec-grupo-total"><span class="tot-valor">${formatarMoeda(total)}</span>${totalGeral ? `<span class="tot-pct"><i class="tot-sep"> · </i>${formatarPct(pct)}%</span>` : ''}</span>
          </summary>
          <div class="rec-grupo-itens">
            ${_barraGrupo(_renderOrdemCriacaoToggle(`${tipoUI}:cronologica:${nome}`))}
            ${itens.map(t => gerarHTMLTransacao(t, tipoUI)).join('')}
          </div>
        </details>`;
    };

    container.innerHTML = `
        <div class="cron-barra" role="img" aria-label="${formatarPct(pctAtual)}% Atual, ${formatarPct(pctPendente)}% ${rotuloPendente}">
          <button type="button" class="cron-barra-seg" data-cron-toggle="Atual"
                  style="--cor-rec:${corAtual}; flex-grow:${Math.max(pctAtual, totalAtual ? 2 : 0)}"
                  title="Atual: ${formatarPct(pctAtual)}% · ${formatarMoeda(totalAtual)}" ${totalAtual ? '' : 'hidden'}></button>
          <button type="button" class="cron-barra-seg" data-cron-toggle="${rotuloPendente}"
                  style="--cor-rec:${corPendente}; flex-grow:${Math.max(pctPendente, totalPendente ? 2 : 0)}"
                  title="${rotuloPendente}: ${formatarPct(pctPendente)}% · ${formatarMoeda(totalPendente)}" ${totalPendente ? '' : 'hidden'}></button>
        </div>
        ${grupoHTML('Atual', corAtual, atuais, totalAtual, pctAtual)}
        ${grupoHTML(rotuloPendente, corPendente, pendentes, totalPendente, pctPendente)}
    `;
    container.onclick = e => {
        const seg = e.target.closest('[data-cron-toggle]');
        if (seg) {
            const det = container.querySelector(`details.rec-grupo[data-nome="${CSS.escape(seg.dataset.cronToggle)}"]`);
            if (det) det.open = !det.open;
            return;
        }
        const ordemBtn = e.target.closest('[data-ordem-criacao-toggle]');
        if (ordemBtn) {
            e.preventDefault(); // está dentro do <summary> — sem isso, o clique também abre/fecha o <details>
            const chave = ordemBtn.dataset.ordemCriacaoToggle;
            _ordemCriacaoGrupo[chave] = !_ordemCriacaoGrupo[chave];
            const det = ordemBtn.closest('details.rec-grupo');
            if (det) det.open = true;
            renderListaCronologica(container, transacoes, tipoUI, msgVazia);
            return;
        }
        onListaTransacaoClick(e);
    };
}

const _porDataDesc = (a, b) => new Date(b.data) - new Date(a.data);

/** Estado aberto/fechado de cada <details class="rec-grupo"> do container,
 *  por nome do grupo — usado pra não fechar tudo sozinho toda vez que a
 *  lista é re-renderizada (ex.: depois de "quitar" uma parcela). Fechado
 *  por padrão (grupo novo == não visto antes). */
function _lerAbertosRecGrupo(container) {
    const abertos = {};
    container?.querySelectorAll('details.rec-grupo[data-nome]').forEach(d => {
        abertos[d.dataset.nome] = d.open;
    });
    return abertos;
}

/** Mesma ideia de _lerAbertosRecGrupo, mas pros subgrupos (Categoria/Forma
 *  de pgto. dentro de "Pontual") — fechados por padrão, mas preservando o
 *  que o usuário já abriu manualmente ao trocar de submodo ou re-renderizar. */
function _lerAbertosSubgrupo(container) {
    const abertos = {};
    container?.querySelectorAll('details.subgrupo[data-nome]').forEach(d => {
        abertos[d.dataset.nome] = d.open;
    });
    return abertos;
}

// Dentro de QUALQUER grupo (de Forma de pgto. ou Categoria — não existe em
// Cronológica: lá os grupos são "Atual"/"A pagar"/"A receber", não fazem
// sentido reorganizar), o usuário pode escolher ver os itens organizados
// pela OUTRA dimensão em vez de cronológico (padrão). Estado por
// "tipoUI:modo:chaveDoGrupo" -> 'cronologica' (nenhum filtro ligado) |
// 'categoria' | 'metodo'.
const _subModoGrupo = {};
function _subModoGrupoDe(tipoUI, modo, grupoChave) {
    return _subModoGrupo[`${tipoUI}:${modo}:${grupoChave}`] || 'cronologica';
}
function _setSubModoGrupo(tipoUI, modo, grupoChave, valor) {
    _subModoGrupo[`${tipoUI}:${modo}:${grupoChave}`] = valor;
}

// Dentro de QUALQUER grupo/subgrupo das listas de Despesas/Receitas
// (Por recorrência, Por método, Por categoria, Cronológica — e os
// subgrupos de dentro de cada um), o usuário pode trocar a ordem
// cronológica (padrão, pela data do lançamento) pela ordem em que os
// lançamentos foram CRIADOS (id maior = criado depois). Chave livre —
// cada chamador monta a sua (tipoUI+modo+nome do grupo/subgrupo) — ->
// bool. Desativado por padrão.
const _ordemCriacaoGrupo = {};
function _ordemCriacaoAtiva(chave) { return !!_ordemCriacaoGrupo[chave]; }
/** Ordena `itens` conforme o toggle da chave — cronológica (padrão) ou
 *  por ordem de criação (id, mais recém-criado primeiro). */
function _ordenarPorGrupo(itens, chave) {
    return itens.sort(_ordemCriacaoAtiva(chave) ? (a, b) => (b.id || 0) - (a.id || 0) : _porDataDesc);
}
/** Botão "Ordenar por criação" reutilizado por todo grupo/subgrupo — o
 *  texto encolhe em níveis conforme o espaço aperta (mesma ideia das
 *  sub-abas de Configuração: cheio -> abreviado -> só emoji), já que ele
 *  divide a linha do cabeçalho com o nome do grupo, a contagem e o total. */
function _renderOrdemCriacaoToggle(chave) {
    const ativo = _ordemCriacaoAtiva(chave);
    return `<span role="button" tabindex="0" class="ordem-criacao-btn${ativo ? ' active' : ''}"
                    data-ordem-criacao-toggle="${String(chave).replace(/"/g, '&quot;')}"
                    title="Ordenar pela ordem em que os lançamentos foram criados, em vez de cronológica">
              <span class="ordcri-emoji">🕓</span><span class="ordcri-full">Ordem de criação</span><span class="ordcri-media">Ordem de criação</span><span class="ordcri-curto">Por criação</span><span class="ordcri-min">Criação</span>
            </span>`;
}

// Quais dimensões aparecem como opção de submodo, conforme o modo (top)
// escolhido — sempre as OUTRAS 2, nunca a mesma dimensão que já agrupa a
// tela toda. Ordem = ordem dos botões.
const _SUBMODOS_POR_MODO = {
    metodo: ['categoria'],
    categoria: ['metodo']
};

/** Config (chave/rótulo/emoji) de cada dimensão usável como submodo. */
function _dimensaoSubmodo(dim, ehDespesa) {
    switch (dim) {
        case 'categoria':
            return { chaveDe: t => t.categoria, semChave: 'Sem categoria', emoji: '🏷️', label: 'Categoria' };
        case 'metodo':
            return { chaveDe: t => t.metodo, semChave: 'Sem forma de pagamento', emoji: '💳', label: 'Forma de pgto.' };
        default:
            return null;
    }
}

/** Reorganiza os itens de UM grupo pela dimensão escolhida (maior total
 *  primeiro) em vez de cronológico — cartõezinhos colapsáveis, fechados por
 *  padrão, com contagem e % (igual ao grupo de fora). */
function _renderItensSubagrupados(itens, tipoUI, dimCfg, abertos, chavePrefixo) {
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;
    const mapa = new Map();
    itens.forEach(t => {
        const k = dimCfg.chaveDe(t) || dimCfg.semChave;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(t);
    });
    const totalGeral = itens.reduce((s, t) => s + valorDe(t), 0);
    const grupos = [...mapa.entries()]
        .map(([nome, its]) => [nome, _ordenarPorGrupo(its, `${chavePrefixo}:sub:${nome}`), its.reduce((s, t) => s + valorDe(t), 0)])
        .sort((a, b) => b[2] - a[2]);
    return grupos.map(([nome, its, total]) => {
        const pct = totalGeral ? (total / totalGeral) * 100 : 0;
        return `
        <details class="subgrupo" data-nome="${String(nome).replace(/"/g, '&quot;')}" ${abertos && abertos[nome] ? 'open' : ''}>
          <summary class="subgrupo-cab">
            <span class="subgrupo-nome">${nome}</span>
            <span class="subgrupo-espaco"></span>
            <span class="subgrupo-contagem">${its.length}</span>
            <span class="subgrupo-total"><span class="tot-valor">${formatarMoeda(total)}</span>${totalGeral ? `<span class="tot-pct"><i class="tot-sep"> · </i>${formatarPct(pct)}%</span>` : ''}</span>
          </summary>
          ${_barraGrupo(_renderOrdemCriacaoToggle(`${chavePrefixo}:sub:${nome}`))}
          ${its.map(t => gerarHTMLTransacao(t, tipoUI)).join('')}
        </details>`;
    }).join('');
}

/** Primeira linha DENTRO do grupo aberto: "Ordem de criação" (à esquerda,
 *  alinhado com o título) e, ao lado, os botões de filtro. */
function _barraGrupo(html) {
    return String(html || '').trim() ? `<div class="grupo-barra">${html}</div>` : '';
}

/** HTML do organizador inline (ícone de funil + botões das outras 2
 *  dimensões) pra colocar ao lado do nome de um grupo, dentro do próprio
 *  <summary> — reutilizado pelos 3 modos que agrupam (Recorrência, Forma de
 *  pgto., Categoria). Cronológica não chama isso (não tem grupos "de
 *  dimensão", tem "Atual"/"A pagar"/"A receber"). */
function _renderOrganizadorInline(tipoUI, modo, grupoChave, ehDespesa) {
    const opcoes = _SUBMODOS_POR_MODO[modo];
    if (!opcoes) return '';
    const subAtual = _subModoGrupoDe(tipoUI, modo, grupoChave);
    const botoes = opcoes.map(dim => {
        const cfg = _dimensaoSubmodo(dim, ehDespesa);
        const full = `${cfg.emoji} ${cfg.label}`;
        return `<span role="button" tabindex="0" class="subgrupo-modo-btn${subAtual === dim ? ' active' : ''}" data-submodo="${dim}" data-full="${full}" data-emoji="${cfg.emoji}">${full}</span>`;
    }).join('');
    return `
        <span class="subgrupo-organizador" data-grupo-chave="${String(grupoChave).replace(/"/g, '&quot;')}">
          <span role="button" tabindex="0" class="subgrupo-modo-icone${subAtual !== 'cronologica' ? ' ativo' : ''}" data-submodo-icone="1" title="Tirar filtro"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 4h18v2.5l-7 8V19l-4 2v-6.5l-7-8V4z"/></svg></span>
          ${botoes}
        </span>`;
}

/** Corpo (itens) de UM grupo, já considerando se ele tem um submodo
 *  escolhido (reorganiza por outra dimensão) ou não (cronológico, padrão). */
function _corpoGrupoComSubmodo(itens, tipoUI, modo, grupoChave, ehDespesa, abertosSub, gerarOpts) {
    const subAtual = _subModoGrupoDe(tipoUI, modo, grupoChave);
    if (subAtual === 'cronologica' || !_SUBMODOS_POR_MODO[modo]) {
        return itens.map(t => gerarHTMLTransacao(t, tipoUI, gerarOpts)).join('');
    }
    return _renderItensSubagrupados(itens, tipoUI, _dimensaoSubmodo(subAtual, ehDespesa), abertosSub, `${tipoUI}:${modo}:${grupoChave}`);
}

// Cache das "próximas" (usado ao renderizar a aba Próximas)
let _proximasCtx = [];

/**
 * Gera HTML para uma transação — card único (sem versão compacta/expandida).
 * Layout: DIA DOW — VALOR MÉTODO CATEGORIA DESCRIÇÃO (linha que quebra).
 * opts.semMetodoChip: não mostra o chip de método (ex.: visão "Por método").
 * opts.semCategoriaChip: não mostra o chip de categoria (visão "Por categoria").
 */
function gerarHTMLTransacao(trans, tipo, opts = {}) {
    const ehParcela = !!trans.parcelasTotal;
    const ehOriginal = ehParcela && trans.parcelaNum === 1;
    // Parcelada: valor da parcela / valor total da compra (ex.: "R$ 15 / 45").
    const valorFormatado = ehParcela
        ? `${formatarMoeda(trans.valor)} <span class="valor-meta">/ ${formatarMoeda(trans.valorTotal || 0)}</span>`
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

    const quandoTag = opts.quando ? `<span class="quando-tag">${opts.quando}</span>` : '';

    // Info da parcela (nunca vai para a descrição — vem dos campos da linha)
    const parcelaTag = ehParcela
        ? `<span class="parcela-tag" title="Parcelamento de ${formatarMoeda(trans.valorTotal || 0)}">${trans.parcelaNum}/${trans.parcelasTotal}</span>`
        : '';
    // Fica ao lado do "1/3", antes dos chips de método/categoria — não mais
    // junto dos ícones de editar/excluir no fim da linha.
    const quitarCheckbox = (ehParcela && !trans.quitada && !opts.semAcoes)
        ? `<label class="quitar-check" title="Quitar a partir deste mês"><input type="checkbox" name="quitar-parcela" data-act="quitar-parc" data-id="${trans.id}" ${trans.quitadoEm ? 'checked' : ''}> quitar</label>`
        : '';
    const quitadoTag = ehParcela && trans.quitadoEm
        ? `<span class="quitado-badge">quitado ${typeof mesTri === 'function' ? mesTri(String(trans.quitadoEm).slice(5, 7)) + '/' + String(trans.quitadoEm).slice(2, 4) : ''}</span>`
        : '';

    const lado = `<span class="despesa-data">`
        + `<span class="despesa-dia">${diaFormatado}</span>`
        + (dowFormatado ? `<span class="despesa-dow">${dowFormatado}</span>` : '')
        + `</span>`;

    // Chip de método (visão "Por método" não mostra — já é a dimensão que agrupa)
    let metaChip = '';
    if (!opts.semMetodoChip) {
        if (trans.metodo) {
            // Encolhe em telas estreitas (CSS troca qual span aparece) —
            // "Crédito Bradesco" -> "CC Bradesco" -> "CC Brad.".
            const itemMetodo = ((estadoApp.menus && estadoApp.menus.metodos) || []).find(m => rotuloMetodo(m) === trans.metodo);
            const niveis = itemMetodo && typeof rotuloMetodoNiveis === 'function' ? rotuloMetodoNiveis(itemMetodo) : null;
            const txtChip = (niveis && niveis.curto !== niveis.full)
                ? `<span class="met-tier-full">${niveis.full}</span><span class="met-tier-media">${niveis.media}</span><span class="met-tier-curto">${niveis.curto}</span>`
                : trans.metodo;
            metaChip = `<span class="chip" style="background:${cor(cores.metodo, trans.metodo)}" title="${String(trans.metodo).replace(/"/g, '&quot;')}">${txtChip}</span>`;
        } else if (trans.formaPagamento && trans.formaPagamento !== 'À vista') {
            metaChip = `<span class="chip chip--neutro">${trans.formaPagamento}</span>`;
        }
    }
    // Nome longo de categoria: no celular mostra a versão abreviada (o nome
    // completo continua no title) pra o chip não empurrar a linha pra baixo.
    const catChip = (!opts.semCategoriaChip && trans.categoria)
        ? chip(cor(cores.categoria, trans.categoria), _htmlNomeCategoriaChip(trans.categoria)) : '';
    const descTxt = trans.descricao
        ? `<span class="despesa-desc">${trans.descricao}</span>` : '';

    // Ações
    let acoes = '';
    if (!opts.semAcoes) {
        if (opts.comAprovarDuplicata) {
            acoes += `<button class="btn-icon btn-success" data-act="aprovar-duplicata" data-id="${trans.id}" title="Não é duplicata — não avisar de novo sobre este lançamento">✓</button>`;
        }
        if (!ehParcela || ehOriginal) {
            acoes += `<button class="btn-icon" data-act="editar-trans" data-id="${trans.id}" title="Editar">✏️</button>`;
        }
        if (!trans.quitada) {
            acoes += `<button class="btn-icon btn-danger" data-act="excluir-trans" data-id="${trans.id}" title="Excluir">🗑️</button>`;
        }
    }

    const classes = `despesa-item ${tipo}` + (trans.quitada ? ' quitada' : '');

    // .despesa-conteudo (dia/valor/tags/descrição) e .despesa-actions são
    // colunas separadas de um flex externo — o conteúdo nunca invade a
    // largura reservada pros ícones (que ficam empilhados, lápis em cima
    // da lixeira, e não junto do resto que quebra linha).
    return `
        <div class="${classes}" data-id="${trans.id}" data-tipo-transacao="${tipo === 'entrada' ? 'entradas' : 'saidas'}">
            <div class="despesa-conteudo">
                ${lado}
                <span class="despesa-valor">${sinal} ${valorFormatado}</span>
                ${(estadoApp.conciliadas && estadoApp.conciliadas.has(trans.id) && trans.origem !== 'pluggy') ? '<span class="conc-selo" title="Conciliado com uma transação do banco (Open Finance)">🏦</span>' : ''}
                ${parcelaTag}
                ${quitarCheckbox}
                ${metaChip}
                ${catChip}
                ${quandoTag}
                ${quitadoTag}
                ${descTxt}
            </div>
            <div class="despesa-actions">${acoes}</div>
        </div>`;
}

/** Delegação de clique nas listas de transações */
function onListaTransacaoClick(e) {
    const aceitarTodas = e.target.closest('[data-dup-aceitar-todas]');
    if (aceitarTodas) {
        e.preventDefault(); // dentro do <summary> — sem isso também abre/fecha o <details>
        const det = aceitarTodas.closest('details.rec-grupo[data-nome="__duplicatas__"]');
        const ids = [...det.querySelectorAll('[data-act="aprovar-duplicata"]')].map(b => Number(b.dataset.id)).filter(Number.isFinite);
        ids.forEach(id => _aprovarDuplicata(id));
        atualizarUI();
        return;
    }
    const apagarTodas = e.target.closest('[data-dup-apagar-todas]');
    if (apagarTodas) {
        e.preventDefault();
        const det = apagarTodas.closest('details.rec-grupo[data-nome="__duplicatas__"]');
        const ids = [...det.querySelectorAll('[data-act="aprovar-duplicata"]')].map(b => Number(b.dataset.id)).filter(Number.isFinite);
        if (!ids.length) return;
        mostrarDialogo({
            titulo: 'Apagar todas as duplicatas?',
            texto: `Remove <strong>${ids.length}</strong> lançamento${ids.length === 1 ? '' : 's'} listado${ids.length === 1 ? '' : 's'} neste grupo. Não dá para desfazer.`,
            acoes: [
                { label: 'Cancelar' },
                { label: 'Apagar todas', primario: true, perigo: true, onClick: async () => {
                    for (const id of ids) await excluirTransacao(id);
                } }
            ]
        });
        return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = Number(el.dataset.id);

    // estadoApp.transacoes só carrega a COMPETÊNCIA do mês em exibição; a
    // lista de "Próximos" filtra por DATA, não por competência — um tipo
    // como "Último dia útil do mês anterior" sempre tem data num mês e
    // competência no seguinte, então um item dela pode não estar em
    // estadoApp.transacoes. Sem isso, confirmar/editar/excluir a partir de
    // "Próximos" não achava a transação e o clique não fazia nada.
    const ctxProximas = (typeof _proximasCtx !== 'undefined' && _proximasCtx) ? _proximasCtx : [];
    const trans = [...estadoApp.transacoes.entradas, ...estadoApp.transacoes.saidas, ...ctxProximas.map(c => c.trans)]
        .find(t => t.id === id);
    if (!trans) return;

    switch (el.dataset.act) {
        case 'quitar-parc':
            quitarParcelamento(id, el.checked);
            break;
        case 'editar-trans': {
            const viaProximasEntrada = ctxProximas.some(c => c.trans.id === id && c.tipoUI === 'entrada');
            const tipo = estadoApp.transacoes.entradas.some(t => t.id === id) || viaProximasEntrada
                ? 'entradas' : 'saidas';
            iniciarEdicaoTransacao(trans, tipo);
            break;
        }
        case 'excluir-trans':
            // Parcela que não é a original: aviso, sem confirmação prévia
            if (trans.parcelasTotal && trans.parcelaNum !== 1) {
                excluirTransacao(id); // deixa a API lançar o detalhe e o catch mostra o diálogo
            } else {
                mostrarDialogo({
                    titulo: 'Excluir lançamento?',
                    texto: `Remove <strong>${trans.descricao || trans.categoria || 'este lançamento'}</strong>. Não dá para desfazer.`,
                    acoes: [
                        { label: 'Cancelar' },
                        { label: 'Excluir', primario: true, perigo: true, onClick: async () => { await excluirTransacao(id); } }
                    ]
                });
            }
            break;
        case 'aprovar-duplicata':
            _aprovarDuplicata(id);
            atualizarUI();
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

/** Carrega a transação no formulário da aba Adicionar em modo edição */
function iniciarEdicaoTransacao(trans, tipoTransacao) {
    estadoApp.editandoId = trans.id;
    const buscaEl = document.getElementById('buscaGlobal');
    if (buscaEl && buscaEl.value) {
        estadoApp.buscaAntesEdicao = buscaEl.value; // volta quando a edição fechar
        buscaEl.value = '';
        document.getElementById('buscaLimpar')?.setAttribute('hidden', '');
        atualizarBuscaGlobal();
    }
    sincronizarModoEdicao();
    // Guarda a tela de origem para voltar depois de salvar/cancelar
    estadoApp.abaOrigemEdicao = document.querySelector('.tab-content.active')?.id || null;

    mudarAba('adicionar');

    // Tipo (entrada/saída) sem recarregar menus
    estadoApp.tipoAtual = tipoTransacao;
    const tipoField = document.querySelector(SELECTORS.tipoTransacao);
    if (tipoField) tipoField.value = tipoTransacao;
    document.querySelector(SELECTORS.formTransacao)?.querySelectorAll('.tipo-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tipo === tipoTransacao));
    atualizarLabelsPorTipo();

    document.querySelector(SELECTORS.data).value = isoParaDiaMes(trans.data);
    document.querySelector(SELECTORS.valor).value = formatarValorParaCampo(trans.valor);
    document.querySelector(SELECTORS.categoria).value = trans.categoria;
    document.querySelector(SELECTORS.descricao).value = trans.descricao || '';
    // Precisa vir depois de setar a categoria: é ela que decide se o campo
    // Método aparece pra receita (categorias "Estorno"/"Reembolso").
    if (tipoTransacao === 'entradas' && typeof atualizarCampoMetodoReceita === 'function') atualizarCampoMetodoReceita();
    document.querySelector(SELECTORS.metodo).value = trans.metodo || '';

    const parc = document.getElementById('parcelas');
    if (parc) parc.value = trans.parcelasTotal || 1;
    const comp = document.getElementById('competencia');
    if (comp) { comp.value = mesDeCompetencia(trans.competencia) || comp.value; comp.dataset.editado = "1"; }

    atualizarCampoParcelas();
    atualizarCampoCredito();

    const btn = document.querySelector('.btn-submit');
    if (btn) btn.textContent = 'Salvar alterações';

    const excluir = document.getElementById('excluirEdicao');
    if (excluir) excluir.hidden = false;
}

/** Sai do modo edição e limpa o formulário (chamado pelo "×" do formulário) */
/** Esconde a busca enquanto um lançamento está sendo editado (só o form aparece). */
function sincronizarModoEdicao() {
    document.body.classList.toggle('editando-lancamento', !!estadoApp.editandoId);
    // Fechou a edição: devolve a busca (e o resultado) de onde ela estava
    if (!estadoApp.editandoId && estadoApp.buscaAntesEdicao) {
        const buscaEl = document.getElementById('buscaGlobal');
        if (buscaEl) {
            buscaEl.value = estadoApp.buscaAntesEdicao;
            document.getElementById('buscaLimpar')?.removeAttribute('hidden');
            atualizarBuscaGlobal();
        }
        estadoApp.buscaAntesEdicao = null;
    }
}

function cancelarEdicaoTransacao(voltarParaOrigem = true) {
    const origem = estadoApp.abaOrigemEdicao;
    estadoApp.editandoId = null;
    sincronizarModoEdicao();
    estadoApp.abaOrigemEdicao = null;
    limparFormulario();
    const btn = document.querySelector('.btn-submit');
    if (btn) btn.textContent = 'Adicionar';
    const excluir = document.getElementById('excluirEdicao');
    if (excluir) excluir.hidden = true;
    // Cancelar pelo botão: volta para a tela onde o usuário estava
    if (voltarParaOrigem && origem && typeof mudarAba === 'function') mudarAba(origem);
}

/** Sem "×" dedicado no formulário: sair da aba "Adicionar" (fechar ou trocar
 *  de aba) enquanto uma edição está em andamento cancela essa edição sozinho
 *  — sem isto, o estado "editando" ficava travado (form preso em modo
 *  edição na próxima vez que o usuário abrisse "+ Lançamento"). */
function _sairDoModoEdicaoSeAtivo() {
    if (estadoApp.editandoId) cancelarEdicaoTransacao(false);
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
    sincronizarModoEdicao();
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

/** Clique dentro da lista de "Próximas" — cobre o organizador inline das
 *  faturas de cartão (data-submodo/data-submodo-icone) antes de cair no
 *  handler padrão (editar/excluir). */
function _onCliqueProximas(e) {
    const subBtn = e.target.closest('[data-submodo]');
    if (subBtn) {
        e.preventDefault();
        const grupoChave = subBtn.closest('[data-grupo-chave]').dataset.grupoChave;
        const atual = _subModoGrupoDe('saida', 'metodo', grupoChave);
        const novo = subBtn.dataset.submodo === atual ? 'cronologica' : subBtn.dataset.submodo;
        _setSubModoGrupo('saida', 'metodo', grupoChave, novo);
        const det = subBtn.closest('details.fatura-item');
        if (det) det.open = true;
        atualizarProximasTransacoes();
        return;
    }
    const subIcone = e.target.closest('[data-submodo-icone]');
    if (subIcone) {
        e.preventDefault();
        const grupoChave = subIcone.closest('[data-grupo-chave]').dataset.grupoChave;
        _setSubModoGrupo('saida', 'metodo', grupoChave, 'cronologica');
        atualizarProximasTransacoes();
        return;
    }
    const ordemBtn = e.target.closest('[data-ordem-criacao-toggle]');
    if (ordemBtn) {
        e.preventDefault(); // está dentro do <summary> — sem isso, o clique também abre/fecha o <details>
        const chave = ordemBtn.dataset.ordemCriacaoToggle;
        _ordemCriacaoGrupo[chave] = !_ordemCriacaoGrupo[chave];
        const det = ordemBtn.closest('details.subgrupo, details.fatura-item, details.rec-grupo');
        if (det) det.open = true;
        atualizarProximasTransacoes();
        return;
    }
    onListaTransacaoClick(e);
}

/**
 * Atualiza a aba "Próximas" — hoje só mostra o resumo de faturas de cartão
 * de crédito do mês em exibição (a lista de recorrências futuras não existe
 * mais, só há lançamentos avulsos/parcelados).
 */
async function atualizarProximasTransacoes() {
    const container = document.querySelector(SELECTORS.proximasLista);
    if (!container) return;

    try {
        // Lê o aberto/fechado ANTES de reescrever (a fatura também usa essa chave).
        const abertosPend = {};
        container.querySelectorAll('details.fatura-item[data-pend]').forEach(d => { abertosPend[d.dataset.pend] = d.open; });
        const pendentesHTML = renderPendentesProximas(abertosPend);
        const faturasHTML = renderFaturasCartao(container);
        const html = pendentesHTML + (faturasHTML || '');
        container.innerHTML = html || `<p class="empty-message">Nada a receber, a pagar nem fatura neste mês</p>`;
        container.onclick = html ? _onCliqueProximas : null;
        container.querySelectorAll('.faturas-cartao .subgrupo-organizador').forEach(_ajustarLabelsFiltro);
    } catch (error) {
        console.error('Erro ao atualizar próximas transações:', error);
        container.innerHTML = '<p class="empty-message">Erro ao carregar próximas transações</p>';
    }
}

/** Grupos "A receber" e "A pagar" da aba Próximos: lançamentos do mês em
 *  exibição que ainda não aconteceram (mesma regra do card de resumo —
 *  _transacaoRealizada), fora os de cartão de crédito, que aparecem em
 *  "Faturas". Abertos por padrão. */
function renderPendentesProximas(abertos = {}, termo = '') {
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const rotulosCredito = new Set(metodos.filter(m => m.metodoKind === 'Crédito').map(m => rotuloMetodo(m)));
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;
    const pend = lista => _filtrarPorBusca(lista || [], termo)
        .filter(t => !rotulosCredito.has(t.metodo) && !_transacaoRealizada(t))
        .sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const grupo = (nome, chave, lista, tipoUI) => {
        if (!lista.length) return '';
        const total = lista.reduce((acc, t) => acc + valorDe(t), 0);
        return `
        <details class="fatura-item" data-pend="${chave}" ${(abertos[chave] !== undefined ? abertos[chave] : !!termo) ? 'open' : ''}>
          <summary>
            <span class="fatura-nome">${nome}</span>
            <span class="fatura-espaco"></span>
            <span class="subgrupo-contagem">${lista.length}</span>
            <span class="fatura-total">${formatarMoeda(total)}</span>
          </summary>
          <div class="fatura-itens">${lista.map(t => gerarHTMLTransacao(t, tipoUI)).join('')}</div>
        </details>`;
    };
    return grupo('A receber', 'receber', pend(estadoApp.transacoes.entradas), 'entrada')
         + grupo('A pagar', 'pagar', pend(estadoApp.transacoes.saidas), 'saida');
}

/** Bloco "Faturas de cartão de crédito": cada cartão com o total lançado no
 *  mês e o dia de vencimento — colapsável, com os lançamentos daquele
 *  cartão dentro (despesas + estornos/reembolsos que abatem a fatura),
 *  fechado por padrão. */
function renderFaturasCartao(container, termo = '', soNaoRealizadas = false) {
    const cartoes = ((estadoApp.menus && estadoApp.menus.metodos) || [])
        .filter(m => m.metodoKind === 'Crédito');
    if (!cartoes.length) return '';
    const mes = estadoApp.mesAtual || new Date();
    const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
    const coresMet = (estadoApp.menus && estadoApp.menus.cores && estadoApp.menus.cores.metodo) || {};
    const valorDe = t => (t.valorMes != null ? t.valorMes : t.valor) || 0;

    const abertos = {};
    container?.querySelectorAll('details.fatura-item[data-nome]').forEach(d => { abertos[d.dataset.nome] = d.open; });
    const abertosSub = _lerAbertosSubgrupo(container);
    // Pseudo-tipoUI fixo pro estado do sub-filtro: a fatura mistura despesas
    // (a maioria) com estornos/reembolsos (poucos), então não há um único
    // tipoUI "certo" — usa 'saida' (é uma tela de cartão de crédito).
    const TIPO_UI_FATURA = 'saida';

    const linhas = cartoes.map(m => {
        const rot = (typeof rotuloMetodo === 'function') ? rotuloMetodo(m) : m.nome;
        const naoFiltra = t => !soNaoRealizadas || !_transacaoRealizada(t);
        const despesas = _filtrarPorBusca(estadoApp.transacoes.saidas.filter(t => t.metodo === rot), termo).filter(naoFiltra);
        // Receita com esse método = estorno/reembolso lançado na fatura —
        // abate do total, não é receita separada (ver calcularResumoMes).
        const estornos = _filtrarPorBusca(estadoApp.transacoes.entradas.filter(t => t.metodo === rot), termo).filter(naoFiltra);
        const totalDespesas = despesas.reduce((s, t) => s + valorDe(t), 0);
        const totalEstornos = estornos.reduce((s, t) => s + valorDe(t), 0);
        const total = totalDespesas - totalEstornos;
        if (!total) return '';
        const diaV = Math.min(parseInt(m.diaVencimento, 10) || 1, ultimoDia);
        const venc = `${String(diaV).padStart(2, '0')}/${String(mes.getMonth() + 1).padStart(2, '0')}`;
        const cor = coresMet[rot] || (typeof corPadraoChip === 'function' ? corPadraoChip(rot) : 'var(--primary)');
        const chaveFatura = `proximas:fatura:${rot}`;
        const todos = _ordenarPorGrupo([...despesas, ...estornos], chaveFatura);
        const tipoUiDe = t => t.tipo === 'entradas' ? 'entrada' : 'saida';

        // Mesmo organizador inline dos outros grupos (Categoria/Recorrência —
        // "Forma de pgto." fica de fora porque a fatura JÁ é agrupada por
        // cartão/método). Cada item pode ser despesa ou receita (estorno),
        // então o corpo é montado na mão aqui (não dá pra usar
        // _corpoGrupoComSubmodo/gerarHTMLTransacao com 1 tipoUI só pra tudo).
        const subAtual = _subModoGrupoDe(TIPO_UI_FATURA, 'metodo', rot);
        let itensHTML;
        if (subAtual === 'cronologica') {
            itensHTML = todos.map(t => gerarHTMLTransacao(t, tipoUiDe(t), { semMetodoChip: true })).join('');
        } else {
            const cfg = _dimensaoSubmodo(subAtual, true);
            const mapa = new Map();
            todos.forEach(t => {
                const k = cfg.chaveDe(t) || cfg.semChave;
                if (!mapa.has(k)) mapa.set(k, []);
                mapa.get(k).push(t);
            });
            const gruposSub = [...mapa.entries()]
                .map(([nome, its]) => [nome, _ordenarPorGrupo(its, `${chaveFatura}:sub:${nome}`), its.reduce((s, t) => s + valorDe(t), 0)])
                .sort((a, b) => b[2] - a[2]);
            itensHTML = gruposSub.map(([nome, its, totalSub]) => {
                const pctSub = total ? (totalSub / total) * 100 : 0;
                return `
                <details class="subgrupo" data-nome="${String(nome).replace(/"/g, '&quot;')}" ${abertosSub[nome] ? 'open' : ''}>
                  <summary class="subgrupo-cab">
                    <span class="subgrupo-nome">${nome}</span>
                    <span class="subgrupo-espaco"></span>
                    <span class="subgrupo-contagem">${its.length}</span>
                    <span class="subgrupo-total"><span class="tot-valor">${formatarMoeda(totalSub)}</span>${total ? `<span class="tot-pct"><i class="tot-sep"> · </i>${formatarPct(pctSub)}%</span>` : ''}</span>
                  </summary>
                  ${_barraGrupo(_renderOrdemCriacaoToggle(`${chaveFatura}:sub:${nome}`))}
                  ${its.map(t => gerarHTMLTransacao(t, tipoUiDe(t), { semMetodoChip: true })).join('')}
                </details>`;
            }).join('');
        }
        const organizadorHTML = _renderOrganizadorInline(TIPO_UI_FATURA, 'metodo', rot, true);

        // Conferência com a fatura do banco (Open Finance): só fora da busca (lá o
        // total é parcial) e quando a Pluggy já trouxe a fatura desse mês.
        let confereBadge = '', confereLinha = '';
        if (!termo) {
            const mesISO = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}`;
            const banco = (estadoApp.faturasBanco || []).find(f => f.metodoId === m.id && String(f.vencimento).slice(0, 7) === mesISO);
            if (banco) {
                const dif = Math.round((total - banco.total) * 100) / 100;
                const vB = String(banco.vencimento).slice(0, 10).split('-').reverse().slice(0, 2).join('/');
                const bate = Math.abs(dif) < 0.005;
                confereBadge = bate
                    ? '<span class="fatura-confere ok" title="Confere com a fatura do banco">✓</span>'
                    : `<span class="fatura-confere dif" title="Diferença de ${formatarMoeda(Math.abs(dif))} em relação à fatura do banco">⚠</span>`;
                confereLinha = `<div class="fatura-banco ${bate ? 'ok' : 'dif'}">🏦 Fatura do banco: <b>${formatarMoeda(banco.total)}</b> (vcto. ${vB})<br>${bate
                    ? '✓ confere com o lançado'
                    : `⚠ ${dif > 0 ? 'lançado a mais' : 'falta lançar'}: <b>${formatarMoeda(Math.abs(dif))}</b>`}</div>`;
            }
        }

        return `
        <details class="fatura-item" data-nome="${rot.replace(/"/g, '&quot;')}" style="--cor-cartao:${cor}" ${abertos[rot] ? 'open' : ''}>
          <summary>
            <span class="fatura-nome">${rot}</span>
            <span class="fatura-espaco"></span>
            <span class="fatura-venc">vcto. ${venc}</span>
            ${confereBadge}
            <span class="fatura-total">${formatarMoeda(total)}</span>
          </summary>
          <div class="fatura-itens">${confereLinha}${_barraGrupo(_renderOrdemCriacaoToggle(chaveFatura) + organizadorHTML)}${itensHTML}</div>
        </details>`;
    }).filter(Boolean).join('');

    return linhas
        ? `<div class="faturas-cartao">${linhas}</div>`
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
    const semEspaco = el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1;
    if (semEspaco) el.textContent = short;
}

/** Mesma ideia de definirLabelResp, mas pra uma FILEIRA inteira de botões de
 *  filtro (data-full/data-emoji cada um) — usado no filtro principal
 *  (Recorrência/Forma de pgto./Categoria) e no organizador inline dentro de
 *  "Pontual" (Categoria/Forma de pgto.). Se a fileira não couber numa linha
 *  só, TODOS os botões encolhem pro emoji junto (troca uniforme, não um de
 *  cada vez) — mantém alinhado e nunca quebra linha. */
function _ajustarLabelsFiltro(rowEl) {
    if (!rowEl) return;
    const btns = [...rowEl.querySelectorAll('[data-full]')];
    if (!btns.length) return;
    btns.forEach(b => { b.textContent = b.dataset.full; });
    requestAnimationFrame(() => {
        if (rowEl.scrollWidth > rowEl.clientWidth + 1) {
            btns.forEach(b => { b.textContent = b.dataset.emoji; });
        }
    });
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

/** Texto mostrado DENTRO da caixa de parcelas: "à vista" pra 1x, "Nx" daí
 *  pra cima (o rótulo "Parcelas" em cima é sempre fixo — só o conteúdo
 *  da caixa muda). */
function _parcelasTexto(n) {
    return n > 1 ? `${n}x` : 'à vista';
}

/** Número de parcelas "de verdade" a partir do que estiver na caixa —
 *  funciona tanto com o texto formatado ("à vista", "3x") quanto com
 *  dígitos crus (campo em edição, ver foco/blur em events.js): parseInt
 *  já para no primeiro caractere não-numérico ("3x" -> 3), e "à vista"
 *  (começa com letra) vira NaN -> cai no padrão de 1. */
function _parcelasNumero(input) {
    return Math.max(1, parseInt(input?.value, 10) || 1);
}

/**
 * Mostra/esconde "Mês" e "Parcelas" — só existem pra despesa em Crédito.
 * O campo de parcelas fica sempre visível junto (setinha ▲▼, começando em
 * "à vista") com o rótulo "Parcelas" fixo — só o CONTEÚDO da caixa muda
 * ("à vista" com 1x, "Nx" com 2x ou mais). O dia de vencimento de cada
 * parcela não é mais perguntado aqui — usa direto o dia já cadastrado no
 * cartão (ver metodoSelecionado().diaVencimento).
 */
function atualizarCampoParcelas() {
    const ehReceita = document.querySelector(SELECTORS.tipoTransacao)?.value === 'entradas';
    const metodoAtual = typeof metodoSelecionado === 'function' ? metodoSelecionado() : null;
    const ehCredito = !ehReceita && !!metodoAtual && metodoAtual.metodoKind === 'Crédito';

    const set = (id, mostrar) => { const el = document.getElementById(id); if (el) el.hidden = !mostrar; };
    // "Mês" (competência): preview de qual mês esse lançamento vai cair,
    // calculado a partir da data da compra + fechamento do cartão — só faz
    // sentido pra Crédito (outros métodos usam o mês da própria data).
    set('competenciaGroup', ehCredito);

    const parcelasInput = document.getElementById('parcelas');
    if (!ehCredito && parcelasInput) parcelasInput.value = _parcelasTexto(1);
    const parcelas = _parcelasNumero(parcelasInput);
    // Enquanto o campo está em edição (foco), mostra dígito cru — não
    // reformata a cada tecla (ver focus/input/blur em events.js).
    if (parcelasInput && document.activeElement !== parcelasInput) {
        parcelasInput.value = _parcelasTexto(parcelas);
    }

    set('parceleGroup', ehCredito);
    set('valorTotalGroup', parcelas > 1);
    atualizarValorTotal();

    if (ehCredito && typeof recalcularCompetencia === 'function') recalcularCompetencia();

    ajustarCamposSozinhos();
}

/** Preenche o campo "Total" (readonly) ao lado do Valor quando parcelado —
 *  "Valor" é o valor de CADA parcela (ver adicionarParceladoAPI em api.js),
 *  então o total é ele vezes o nº de parcelas. */
function atualizarValorTotal() {
    const tot = document.getElementById('valorTotal');
    if (!tot) return;
    const v = valorCampoParaNumero(document.querySelector(SELECTORS.valor));
    const mult = typeof _parcelasNumero === 'function' ? _parcelasNumero(document.getElementById('parcelas')) : 1;
    tot.value = formatarMoeda(v * mult);
}

/**
 * Ajusta rótulos e campos conforme o tipo (receita = entradas | despesa = saidas):
 * - receita não tem método (campo escondido, não obrigatório)
 * - "Dia de vencimento" vira "Dia do pagamento"; checkbox muda de texto
 */
function atualizarLabelsPorTipo() {
    const ehReceita = document.querySelector(SELECTORS.tipoTransacao)?.value === 'entradas';

    const metodoSel = document.querySelector(SELECTORS.metodo);
    if (ehReceita) {
        // Receita normalmente não tem método — exceto "Reembolso/Estorno"
        // (ver atualizarCampoMetodoReceita), que pode vir via Pix ou direto
        // na fatura do cartão.
        atualizarCampoMetodoReceita();
        const compGrp = document.getElementById('competenciaGroup');
        if (compGrp) compGrp.hidden = true;
    } else {
        const blocoMetodo = document.getElementById('metodoBloco');
        if (blocoMetodo) blocoMetodo.hidden = false;
        if (metodoSel) metodoSel.required = true;
        // A lista pode ter ficado restrita a Crédito/PIX-Débito (Estorno/
        // Reembolso na receita) — repõe a lista completa pra despesa.
        if (typeof preencherDropdownMetodos === 'function') preencherDropdownMetodos();
        if (typeof atualizarCampoCredito === 'function') atualizarCampoCredito();
    }

    // Categorias são específicas de receita x despesa
    if (typeof preencherDropdownCategorias === 'function') preencherDropdownCategorias();

    ajustarCamposSozinhos();
}

/**
 * Insere uma categoria nova na posição ALFABÉTICA dentro da lista atual, em
 * vez de jogar pro fim. "ordem" é inteira no banco, então não dá pra
 * encaixar num ponto fracionário: o item novo assume a "ordem" de quem
 * viria depois dele alfabeticamente, e só os itens A PARTIR DAQUELE PONTO
 * (não a lista toda) são empurrados +1 — quem já vinha antes não muda.
 */
async function _inserirCategoriaAlfabetica(lista, nome, dadosExtra) {
    const itens = [...(lista || [])]
        .sort((a, b) => {
            const oa = a.ordem ?? Infinity, ob = b.ordem ?? Infinity;
            return oa - ob || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
        })
        .map((item, i) => ({ ...item, _ordemEfetiva: item.ordem ?? (i + 1) }));

    const depois = itens.findIndex(it => String(it.nome).localeCompare(nome, 'pt-BR') > 0);
    const novaOrdem = depois === -1
        ? (itens.length ? itens[itens.length - 1]._ordemEfetiva + 1 : 1)
        : itens[depois]._ordemEfetiva;

    const ok = await adicionarItemMenuAPI('Categoria', nome, { ...dadosExtra, ordem: novaOrdem });
    if (!ok) return false;

    if (depois !== -1) {
        const deslocamentos = itens.slice(depois).map(it => ({ id: it.linha, ordem: it._ordemEfetiva + 1 }));
        if (deslocamentos.length) await salvarOrdemMenuAPI(deslocamentos);
    }
    return true;
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
                // estadoApp.menus.categoriasReceita/Despesa são só listas de NOMES
                // (o que o dropdown do formulário precisa) — a ordenação alfabética
                // exige os itens completos (ordem/linha), então busca fresco aqui.
                const todasCategorias = typeof obterItensPorTipo === 'function' ? await obterItensPorTipo('Categoria') : [];
                const listaAtual = (todasCategorias || []).filter(c => (c.categoriaTipo || 'saidas') === tipo);
                const ok = await _inserirCategoriaAlfabetica(listaAtual, nome, {
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
        titulo: 'Nova forma de pagamento',
        corpoHTML: `
            <div class="campo"><label for="dlgMetKind">Tipo</label>
                <select id="dlgMetKind">
                    <option value="">Selecione...</option>
                    <option value="PIX">PIX</option>
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
                // O valor das <option> do dropdown é rotuloMetodo() (kind + banco
                // sem travessão), não o "nome" salvo no banco (que usa "—") —
                // setar sel.value = nome não batia com nenhuma option e a seleção
                // ficava muda (voltava pra "Selecione...", parecendo que o botão
                // "Adicionar" não tinha feito nada).
                if (sel) sel.value = banco ? `${kind} ${banco}` : kind;
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
 * Chamado quando o Método muda — o campo Parcelas (só existe em Crédito) e a
 * Competência dependem do método escolhido.
 */
function atualizarCampoCredito() {
    if (typeof atualizarCampoParcelas === 'function') atualizarCampoParcelas();
}

/**
 * Receita normalmente não tem campo Método (bloco inteiro escondido). As
 * exceções são as categorias fixas "Estorno" (volta na fatura do cartão —
 * só aceita Método de Crédito) e "Reembolso" (volta via Pix/transferência —
 * só aceita Método PIX/Débito): mostram o campo (opcional), já restrito ao
 * tipo de método que faz sentido pra cada uma.
 */
function atualizarCampoMetodoReceita() {
    // Só se aplica à Receita — é ela que esconde o bloco Método por padrão
    // (mostrando de volta só pra Estorno/Reembolso). Despesa SEMPRE mostra
    // o campo; como o listener de "categoria muda" chama esta função sem
    // saber qual tipo está ativo, sem essa guarda trocar de categoria numa
    // Despesa escondia (e limpava) a Forma de pgto. sozinho.
    const ehReceita = document.querySelector(SELECTORS.tipoTransacao)?.value === 'entradas';
    if (!ehReceita) return;

    const categoriaAtual = document.querySelector(SELECTORS.categoria)?.value;
    const ehEstorno = categoriaAtual === CATEGORIA_ESTORNO;
    const ehReembolso = categoriaAtual === CATEGORIA_REEMBOLSO;
    // Receita SEMPRE mostra a Forma de pagamento (opcional). Todas as formas
    // aparecem; as que não servem pra categoria escolhida ficam cinzas
    // (desabilitadas): só "Estorno" aceita cartão de crédito; qualquer outra
    // categoria (Reembolso incluso) aceita só Pix/Dinheiro/etc., sem crédito.
    const blocoMetodo = document.getElementById('metodoBloco');
    if (blocoMetodo) blocoMetodo.hidden = false;
    const metodoSel = document.querySelector(SELECTORS.metodo);
    if (metodoSel) {
        metodoSel.required = false;
        const atual = metodoSel.value;
        metodoSel.innerHTML = '<option value="">Selecione...</option>';
        (estadoApp.menus.metodos || []).forEach(m => {
            const label = rotuloMetodo(m);
            const o = document.createElement('option');
            o.value = label; o.textContent = label;
            o.disabled = ehEstorno ? m.metodoKind !== 'Crédito' : m.metodoKind === 'Crédito';
            metodoSel.appendChild(o);
        });
        const opAtual = [...metodoSel.options].find(o => o.value === atual);
        metodoSel.value = opAtual && !opAtual.disabled ? atual : '';
    }
    const compGrp = document.getElementById('competenciaGroup');
    if (compGrp) compGrp.hidden = true; // receita nunca mostra o select "Mês"
    const parceleGrp = document.getElementById('parceleGroup');
    if (parceleGrp) parceleGrp.hidden = true;
    ajustarCamposSozinhos();
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


// Abreviações de palavras comuns em nomes de categoria; qualquer outra palavra
// com mais de 8 letras vira as 5 primeiras + ".".
const _ABREV_CATEGORIA = {
    transporte: 'Transp.', alimentação: 'Aliment.', serviços: 'Serv.', educação: 'Educ.',
    manutenção: 'Manut.', assinaturas: 'Assin.', restaurante: 'Rest.', farmácia: 'Farm.',
    eletrônicos: 'Eletr.', alcoólica: 'alc.', alcoólicas: 'alc.', supermercado: 'Superm.',
    entretenimento: 'Entret.', vestuário: 'Vest.', investimentos: 'Invest.', combustível: 'Comb.',
    telecomunicações: 'Telecom.', comunicação: 'Comun.', estacionamento: 'Estac.',
};
function abreviarCategoria(nome) {
    return String(nome).split(' ').map(p => {
        const ab = _ABREV_CATEGORIA[p.toLowerCase()];
        if (ab) return p[0] === p[0].toUpperCase() ? ab[0].toUpperCase() + ab.slice(1) : ab;
        return p.length > 8 ? p.slice(0, 5) + '.' : p;
    }).join(' ');
}
/** Chip de categoria: nome inteiro + versão abreviada (só nomes > 13 letras);
 *  o CSS mostra a abreviada em telas estreitas (ver .cat-curto em theme.css). */
function _htmlNomeCategoriaChip(nome) {
    const curto = abreviarCategoria(nome);
    if (String(nome).length <= 13 || curto === nome) return nome;
    return `<span class="cat-full">${nome}</span><span class="cat-curto">${curto}</span>`;
}

/**
 * VISÃO ANUAL — página própria (#anual, botão 📈 do cabeçalho) pra comparar e
 * acompanhar mês a mês os gastos (ou receitas) do ano, por categoria ou por
 * forma de pagamento. Ao abrir, esconde o resto do app (classe body.modo-anual);
 * clicar no botão de novo volta ao normal.
 *
 * Extras: filtro por uma categoria/forma, comparação com o ano anterior e
 * orçamento mensal por categoria de despesa (tabela `orcamentos`).
 * Mesma regra do dashboard: receita com forma "Crédito" é estorno/reembolso e
 * abate a despesa desse cartão.
 */

const MESES_ANUAL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_ANUAL_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const estadoAnual = {
    ano: new Date().getFullYear(),
    tipo: 'saidas',       // 'saidas' | 'entradas'
    agrupar: 'categoria', // 'categoria' | 'metodo'
    filtro: '',           // nome de uma linha (categoria/forma) ou '' = todas
    comparar: false,      // compara com o ano anterior
    porAno: {},           // ano -> transações
    orcamentos: {},       // categoria -> valor mensal
    carregando: false,
};

/** Todas as transações do ano (a API devolve no máximo 1000 por chamada). */
async function _buscarTransacoesDoAno(ano) {
    const todas = [];
    for (let ini = 0; ; ini += 1000) {
        const { data, error } = await sb.from('transacoes')
            .select('id, tipo, valor, categoria, metodo, competencia')
            .gte('competencia', `${ano}-01-01`).lt('competencia', `${ano + 1}-01-01`)
            .order('id').range(ini, ini + 999);
        if (error) throw error;
        todas.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return todas;
}

async function _carregarOrcamentos() {
    const { data, error } = await sb.from('orcamentos').select('categoria, valor');
    if (error) { console.warn('Orçamentos indisponíveis:', error.message); return; }
    estadoAnual.orcamentos = Object.fromEntries((data || []).map(o => [o.categoria, Number(o.valor)]));
}

const _brl0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const _brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const _anualOculto = () => typeof valoresOcultos !== 'undefined' && valoresOcultos;
const _fmtCel = v => (_anualOculto() ? '••' : _brl0.format(Math.round(v)));
const _fmtMoeda = v => (_anualOculto() ? 'R$ ••••' : _brl2.format(v));
const _esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "PIX Mercado pago" e "PIX" são a mesma forma (tudo é PIX). */
function _chaveMetodoAnual(m) {
    const s = String(m || '').trim();
    if (!s) return '(sem forma)';
    return /^pix(\s|$)/i.test(s) ? 'PIX' : s;
}

/** Calcula {linhas:[{nome, meses:[12], total}], totais:[12], temEstorno} de um ano
 *  com o tipo/agrupamento atuais (sem o filtro de uma linha). */
function _calcularAno(linhas) {
    const { tipo, agrupar } = estadoAnual;
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const rotulosCredito = new Set(metodos
        .filter(m => m.metodoKind === 'Crédito')
        .map(m => (typeof rotuloMetodo === 'function' ? rotuloMetodo(m) : m.nome)));
    const mapa = new Map();
    const somar = (nome, mes, valor) => {
        if (!mapa.has(nome)) mapa.set(nome, Array(12).fill(0));
        mapa.get(nome)[mes] += valor;
    };
    let temEstorno = false;
    for (const t of linhas || []) {
        const mes = parseInt(String(t.competencia).slice(5, 7), 10) - 1;
        if (!(mes >= 0 && mes < 12)) continue;
        const valor = Number(t.valor) || 0;
        const estorno = t.tipo === 'entradas' && rotulosCredito.has(t.metodo);
        const nomeLinha = agrupar === 'categoria' ? (t.categoria || '(sem categoria)') : _chaveMetodoAnual(t.metodo);
        if (tipo === 'saidas') {
            if (t.tipo === 'saidas') somar(nomeLinha, mes, valor);
            else if (estorno) {
                temEstorno = true;
                // Estorno abate a fatura do cartão (por forma) ou vira uma linha própria (por categoria)
                somar(agrupar === 'categoria' ? '(−) Estornos no cartão' : _chaveMetodoAnual(t.metodo), mes, -valor);
            }
        } else if (t.tipo === 'entradas' && !estorno) {
            somar(nomeLinha, mes, valor);
        }
    }
    const lista = [...mapa.entries()].map(([nome, meses]) => ({ nome, meses, total: meses.reduce((a, b) => a + b, 0) }))
        .filter(l => l.meses.some(v => Math.abs(v) > 0.004))
        .sort((a, b) => (a.nome.startsWith('(−)') ? 1 : 0) - (b.nome.startsWith('(−)') ? 1 : 0) || b.total - a.total);
    return { linhas: lista, temEstorno };
}

/** Aplica o filtro (uma linha só) e soma os totais mensais. */
function _visao(ano) {
    const base = _calcularAno(estadoAnual.porAno[ano]);
    const linhas = estadoAnual.filtro ? base.linhas.filter(l => l.nome === estadoAnual.filtro) : base.linhas;
    const totais = Array(12).fill(0);
    linhas.forEach(l => l.meses.forEach((v, i) => { totais[i] += v; }));
    return { todas: base.linhas, linhas, totais, temEstorno: base.temEstorno };
}

function _corDoNomeAnual(nome) {
    const cores = (estadoApp.menus && estadoApp.menus.cores) || {};
    const mapa = estadoAnual.agrupar === 'categoria' ? cores.categoria : cores.metodo;
    return (mapa && mapa[nome]) || (typeof corPadraoChip === 'function' ? corPadraoChip(nome) : '#6366F1');
}

function _graficoBarrasAnual(totais, totaisAnt, mesAtual) {
    const max = Math.max(...totais, ...(totaisAnt || []), 1);
    const largura = 600, alturaBarras = 110, base = 128, passo = largura / 12;
    const bw = totaisAnt ? passo * 0.36 : passo * 0.6;
    const cor = estadoAnual.tipo === 'entradas' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const alt = v => (v > 0 ? Math.max(3, (v / max) * alturaBarras) : 0);
    const barras = totais.map((v, i) => {
        const atual = i === mesAtual;
        const x0 = i * passo + (passo - (totaisAnt ? bw * 2 + 2 : bw)) / 2;
        const h = alt(v);
        let s = '';
        if (totaisAnt) {
            const ha = alt(totaisAnt[i]);
            s += `<rect x="${x0.toFixed(1)}" y="${(base - ha).toFixed(1)}" width="${bw.toFixed(1)}" height="${ha.toFixed(1)}" rx="3" class="anual-barra-ant"/>`;
        }
        const xa = totaisAnt ? x0 + bw + 2 : x0;
        s += `<rect x="${xa.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${cor}" opacity="${atual ? 1 : 0.6}"/>`;
        return `<g><title>${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(v)}${totaisAnt ? ` (${estadoAnual.ano - 1}: ${_fmtMoeda(totaisAnt[i])})` : ''}</title>${s}
            <text x="${(i * passo + passo / 2).toFixed(1)}" y="146" text-anchor="middle" class="anual-eixo${atual ? ' atual' : ''}">${MESES_ANUAL[i]}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${largura} 154" class="anual-grafico" role="img" aria-label="Total por mês">
        <line x1="0" y1="${base}" x2="${largura}" y2="${base}" class="anual-base"/>${barras}</svg>`;
}

function _pct(atual, anterior) {
    return anterior ? ((atual - anterior) / Math.abs(anterior)) * 100 : null;
}
/** classe bom/ruim conforme o tipo: despesa subir é ruim, receita subir é bom */
function _classeVar(p) {
    if (p === null || Math.abs(p) < 0.5) return '';
    const bom = estadoAnual.tipo === 'entradas' ? p > 0 : p < 0;
    return bom ? 'bom' : 'ruim';
}

function _renderVisaoAnual() {
    const cont = document.getElementById('anualConteudo');
    if (!cont) return;
    const { ano, tipo, agrupar, comparar } = estadoAnual;
    const v = _visao(ano);
    const ant = comparar ? _visao(ano - 1) : null;
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() === ano ? hoje.getMonth() : -1;
    const ultimoMes = hoje.getFullYear() === ano ? hoje.getMonth() : (ano < hoje.getFullYear() ? 11 : -1);
    const { linhas, totais } = v;
    const totalAno = totais.reduce((a, b) => a + b, 0);
    const decorridos = ultimoMes + 1;
    const media = decorridos ? totais.slice(0, decorridos).reduce((a, b) => a + b, 0) / decorridos : 0;
    const iMax = totais.reduce((im, x, i) => (x > totais[im] ? i : im), 0);
    const nomeTipo = tipo === 'entradas' ? 'Receitas' : 'Despesas';
    const ref = ultimoMes >= 0 ? ultimoMes : 0;
    const varMes = ref > 0 ? _pct(totais[ref], totais[ref - 1]) : null;
    const fmtVar = p => (p === null ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p).toFixed(0)}%`);

    // Orçamento (só despesa por categoria)
    const usaOrc = tipo === 'saidas' && agrupar === 'categoria';
    const orc = usaOrc ? estadoAnual.orcamentos : {};
    const somaOrc = linhas.reduce((a, l) => a + (orc[l.nome] || 0), 0);
    const gastoNoMesOrc = linhas.filter(l => orc[l.nome]).reduce((a, l) => a + (ref >= 0 ? l.meses[ref] : 0), 0);

    const maxCel = Math.max(1, ...linhas.flatMap(l => l.meses.map(x => Math.abs(x))));
    const corHeat = tipo === 'entradas' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const antPorNome = ant ? new Map(ant.todas.map(l => [l.nome, l])) : null;
    const linhasHTML = linhas.map(l => {
        const negativa = l.nome.startsWith('(−)');
        const limite = usaOrc && !negativa ? (orc[l.nome] || 0) : 0;
        const cel = l.meses.map((x, i) => {
            if (Math.abs(x) < 0.005) return `<td class="vazio">–</td>`;
            const forca = Math.round(8 + 42 * Math.min(1, Math.abs(x) / maxCel));
            const estourou = limite && x > limite;
            return `<td class="cel${i === mesAtual ? ' atual' : ''}${estourou ? ' estourou' : ''}" style="background:color-mix(in srgb, ${negativa ? 'var(--receita-text)' : corHeat} ${forca}%, transparent)" title="${_esc(l.nome)} · ${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(x)}${estourou ? ` — acima do orçamento (${_fmtMoeda(limite)})` : ''}">${_fmtCel(x)}</td>`;
        }).join('');
        const ponto = negativa ? '' : `<i class="anual-ponto" style="background:${_corDoNomeAnual(l.nome)}"></i>`;
        const alvoFiltro = negativa ? '' : ` data-anual-linha="${_esc(l.nome)}" title="Filtrar só ${_esc(l.nome)}"`;
        const totAnt = antPorNome ? (antPorNome.get(l.nome) || { total: 0 }).total : null;
        const pct = totAnt !== null ? _pct(l.total, totAnt) : null;
        const colAnt = comparar ? `<td class="ant">${totAnt ? _fmtCel(totAnt) : '–'}</td><td class="delta ${_classeVar(pct)}">${pct === null ? '–' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}</td>` : '';
        const colOrc = usaOrc ? (negativa ? '<td></td>' : `<td class="orc"><button type="button" data-anual-orc="${_esc(l.nome)}" title="Definir orçamento mensal de ${_esc(l.nome)}">${limite ? _fmtCel(limite) : '+'}</button></td>`) : '';
        return `<tr><th scope="row" class="anual-nome${negativa ? '' : ' clicavel'}"${alvoFiltro}>${ponto}<span>${_esc(l.nome)}</span></th>${cel}<td class="total">${_fmtCel(l.total)}</td>${colAnt}${colOrc}</tr>`;
    }).join('');

    const deltas = totais.map((x, i) => {
        if (i === 0 || !totais[i - 1] || (ultimoMes >= 0 && i > ultimoMes)) return `<td class="vazio">–</td>`;
        const p = _pct(x, totais[i - 1]);
        return `<td class="delta ${_classeVar(p)}">${p > 0 ? '+' : ''}${p.toFixed(0)}%</td>`;
    }).join('');

    const totAntAno = ant ? ant.totais.reduce((a, b) => a + b, 0) : null;
    const pctAno = ant ? _pct(totalAno, totAntAno) : null;
    const cabExtra = (comparar ? `<th class="total">${ano - 1}</th><th class="total">Δ</th>` : '') + (usaOrc ? '<th class="total" title="Orçamento mensal por categoria">Orçam.</th>' : '');
    const rodTot = (comparar ? `<td class="ant">${_fmtCel(totAntAno)}</td><td class="delta ${_classeVar(pctAno)}">${pctAno === null ? '–' : `${pctAno > 0 ? '+' : ''}${pctAno.toFixed(0)}%`}</td>` : '') + (usaOrc ? `<td class="orc">${somaOrc ? _fmtCel(somaOrc) : ''}</td>` : '');
    const rodVar = (comparar ? '<td></td><td></td>' : '') + (usaOrc ? '<td></td>' : '');

    // Opções do filtro
    const opcoes = v.todas.filter(l => !l.nome.startsWith('(−)')).map(l => `<option value="${_esc(l.nome)}"${l.nome === estadoAnual.filtro ? ' selected' : ''}>${_esc(l.nome)}</option>`).join('');
    const rotuloTodas = agrupar === 'categoria' ? 'Todas as categorias' : 'Todas as formas';

    cont.innerHTML = `
        <div class="anual-filtros">
            <select id="anualFiltro" aria-label="Filtrar"><option value="">${rotuloTodas}</option>${opcoes}</select>
            <button type="button" class="anual-toggle${comparar ? ' active' : ''}" data-anual-comparar title="Comparar com ${ano - 1}">⇄ Comparar com ${ano - 1}</button>
        </div>
        <div class="anual-cards">
            <div class="anual-card"><span>${nomeTipo} no ano</span><b>${_fmtMoeda(totalAno)}</b></div>
            <div class="anual-card"><span>Média por mês</span><b>${_fmtMoeda(media)}</b></div>
            <div class="anual-card"><span>Maior mês</span><b>${totalAno ? `${MESES_ANUAL_LONGO[iMax]} · ${_fmtMoeda(totais[iMax])}` : '—'}</b></div>
            <div class="anual-card"><span>${MESES_ANUAL[ref]} vs. mês anterior</span><b class="${_classeVar(varMes)}">${fmtVar(varMes)}</b></div>
            ${comparar ? `<div class="anual-card"><span>${ano} vs. ${ano - 1}</span><b class="${_classeVar(pctAno)}">${fmtVar(pctAno)}</b><small>${_fmtMoeda(totAntAno)} em ${ano - 1}</small></div>` : ''}
            ${somaOrc ? `<div class="anual-card"><span>Orçamento de ${MESES_ANUAL[ref]}</span><b class="${gastoNoMesOrc > somaOrc ? 'ruim' : 'bom'}">${_fmtMoeda(gastoNoMesOrc)} de ${_fmtMoeda(somaOrc)}</b></div>` : ''}
        </div>
        <div class="anual-grafico-wrap">${_graficoBarrasAnual(totais, ant ? ant.totais : null, mesAtual)}
            ${comparar ? `<p class="anual-legenda"><i class="anual-barra-ant-lg"></i> ${ano - 1} &nbsp; <i class="anual-barra-atual-lg ${tipo}"></i> ${ano}</p>` : ''}</div>
        ${linhas.length ? `
        <div class="anual-tabela-wrap">
            <table class="anual-tabela">
                <thead><tr><th class="anual-nome">${agrupar === 'categoria' ? 'Categoria' : 'Forma de pgto.'}</th>
                    ${MESES_ANUAL.map((m, i) => `<th class="mes${i === mesAtual ? ' atual' : ''}"><button type="button" data-ir-mes="${i}" title="Ir para ${MESES_ANUAL_LONGO[i]}">${m}</button></th>`).join('')}
                    <th class="total">Total</th>${cabExtra}</tr></thead>
                <tbody>${linhasHTML}</tbody>
                <tfoot>
                    <tr class="tot"><th scope="row" class="anual-nome">Total</th>${totais.map((x, i) => `<td class="${i === mesAtual ? 'atual' : ''}">${x ? _fmtCel(x) : '–'}</td>`).join('')}<td class="total">${_fmtCel(totalAno)}</td>${rodTot}</tr>
                    <tr class="var"><th scope="row" class="anual-nome">vs. mês anterior</th>${deltas}<td></td>${rodVar}</tr>
                </tfoot>
            </table>
        </div>
        <p class="menu-hint anual-nota">Valores em R$ (sem centavos), pelo mês da competência${v.temEstorno ? '; estornos/reembolsos no cartão abatem a despesa' : ''}. Toque num mês para abri-lo${usaOrc ? ', no nome de uma categoria para filtrá-la e em “Orçam.” para definir o limite mensal (célula acima do limite fica com borda vermelha)' : ''}.</p>`
        : `<p class="empty-message">Nada lançado em ${ano}${estadoAnual.filtro ? ` para “${_esc(estadoAnual.filtro)}”` : ''}.</p>`}`;
}

/** Abre a página, carrega o(s) ano(s) necessário(s) e desenha. */
async function carregarVisaoAnual(forcar = false) {
    const cont = document.getElementById('anualConteudo');
    if (!cont || estadoAnual.carregando) return;
    document.getElementById('anualAno').textContent = estadoAnual.ano;
    document.querySelectorAll('#anual [data-anual-tipo]').forEach(b => b.classList.toggle('active', b.dataset.anualTipo === estadoAnual.tipo));
    document.querySelectorAll('#anual [data-anual-agrupar]').forEach(b => b.classList.toggle('active', b.dataset.anualAgrupar === estadoAnual.agrupar));
    const anos = [estadoAnual.ano, ...(estadoAnual.comparar ? [estadoAnual.ano - 1] : [])];
    const faltam = forcar ? anos : anos.filter(a => !estadoAnual.porAno[a]);
    if (forcar || faltam.length) {
        estadoAnual.carregando = true;
        if (faltam.length) cont.innerHTML = '<p class="loading">Carregando...</p>';
        try {
            for (const a of faltam) estadoAnual.porAno[a] = await _buscarTransacoesDoAno(a);
            if (forcar) await _carregarOrcamentos();
        } catch (e) {
            console.error(e);
            cont.innerHTML = '<p class="empty-message">Erro ao carregar o ano</p>';
            return;
        } finally {
            estadoAnual.carregando = false;
        }
    }
    _renderVisaoAnual();
}

/** Diálogo do orçamento mensal de uma categoria. */
function _editarOrcamento(categoria) {
    const atual = estadoAnual.orcamentos[categoria];
    mostrarDialogo({
        titulo: `Orçamento mensal — ${_esc(categoria)}`,
        corpoHTML: `<div class="campo"><label for="dlgOrcValor">Limite por mês (R$)</label>
            <input type="text" id="dlgOrcValor" inputmode="decimal" placeholder="Ex: 800,00" value="${atual ? String(atual).replace('.', ',') : ''}" autocomplete="off"></div>
            <p class="menu-hint">Vale para todos os meses. Os meses acima do limite ficam com borda vermelha.</p>`,
        acoes: [
            { label: 'Cancelar' },
            ...(atual ? [{ label: 'Remover', perigo: true, onClick: async () => {
                const { error } = await sb.from('orcamentos').delete().eq('categoria', categoria);
                if (error) { mostrarNotificacao('Erro ao remover o orçamento', 'erro'); return true; }
                delete estadoAnual.orcamentos[categoria];
                _renderVisaoAnual();
            } }] : []),
            { label: 'Salvar', primario: true, onClick: async (ov) => {
                const v = parseFloat(String(ov.querySelector('#dlgOrcValor').value).replace(/\./g, '').replace(',', '.'));
                if (!(v > 0)) { mostrarNotificacao('Informe um valor maior que zero', 'info'); return true; }
                const { error } = await sb.from('orcamentos').upsert({ categoria, valor: v }, { onConflict: 'user_id,categoria' });
                if (error) { console.error(error); mostrarNotificacao('Erro ao salvar o orçamento', 'erro'); return true; }
                estadoAnual.orcamentos[categoria] = v;
                _renderVisaoAnual();
            } },
        ],
    });
}

function iniciarVisaoAnual() {
    const aba = document.getElementById('anual');
    if (!aba) return;
    aba.addEventListener('click', async e => {
        const btnTipo = e.target.closest('[data-anual-tipo]');
        const btnAgr = e.target.closest('[data-anual-agrupar]');
        const btnAno = e.target.closest('[data-anual-ano]');
        const btnMes = e.target.closest('[data-ir-mes]');
        const btnOrc = e.target.closest('[data-anual-orc]');
        const linha = e.target.closest('[data-anual-linha]');
        if (btnTipo) { estadoAnual.tipo = btnTipo.dataset.anualTipo; estadoAnual.filtro = ''; carregarVisaoAnual(); }
        else if (btnAgr) { estadoAnual.agrupar = btnAgr.dataset.anualAgrupar; estadoAnual.filtro = ''; carregarVisaoAnual(); }
        else if (btnAno) { estadoAnual.ano += Number(btnAno.dataset.anualAno); estadoAnual.filtro = ''; carregarVisaoAnual(); }
        else if (e.target.closest('[data-anual-comparar]')) { estadoAnual.comparar = !estadoAnual.comparar; carregarVisaoAnual(); }
        else if (btnOrc) { _editarOrcamento(btnOrc.dataset.anualOrc); }
        else if (linha) { estadoAnual.filtro = estadoAnual.filtro === linha.dataset.anualLinha ? '' : linha.dataset.anualLinha; _renderVisaoAnual(); }
        else if (btnMes) {
            // Leva o app pro mês tocado e volta ao normal
            estadoApp.mesAtual = new Date(estadoAnual.ano, Number(btnMes.dataset.irMes), 1);
            if (typeof fecharAbas === 'function') fecharAbas();
            if (typeof recarregarDados === 'function') await recarregarDados();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    aba.addEventListener('change', e => {
        if (e.target.id === 'anualFiltro') { estadoAnual.filtro = e.target.value; _renderVisaoAnual(); }
    });
}

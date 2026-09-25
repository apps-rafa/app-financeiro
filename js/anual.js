/**
 * VISÃO ANUAL — comparar e acompanhar mês a mês os gastos (ou receitas) do ano,
 * por categoria ou por forma de pagamento. Aba própria (#anual), aberta pelo
 * botão 📈 do cabeçalho. Mesma regra do dashboard: receita com forma de
 * pagamento "Crédito" é estorno/reembolso e abate a despesa desse cartão.
 */

const MESES_ANUAL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_ANUAL_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const estadoAnual = {
    ano: new Date().getFullYear(),
    tipo: 'saidas',      // 'saidas' | 'entradas'
    agrupar: 'categoria', // 'categoria' | 'metodo'
    linhas: null,        // transações do ano carregado
    anoCarregado: null,
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

const _brl0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const _brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const _anualOculto = () => typeof valoresOcultos !== 'undefined' && valoresOcultos;
const _fmtCel = v => (_anualOculto() ? '••' : _brl0.format(Math.round(v)));
const _fmtMoeda = v => (_anualOculto() ? 'R$ ••••' : _brl2.format(v));

/** "PIX Mercado pago" e "PIX" são a mesma forma (tudo é PIX). */
function _chaveMetodoAnual(m) {
    const s = String(m || '').trim();
    if (!s) return '(sem forma)';
    return /^pix(\s|$)/i.test(s) ? 'PIX' : s;
}

/** Monta {linhas:[{nome, meses:[12], total}], totais:[12]} do tipo/agrupamento atuais. */
function _calcularVisaoAnual() {
    const { linhas, tipo, agrupar } = estadoAnual;
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const rotulosCredito = new Set(metodos
        .filter(m => m.metodoKind === 'Crédito')
        .map(m => (typeof rotuloMetodo === 'function' ? rotuloMetodo(m) : m.nome)));
    const ehCredito = m => rotulosCredito.has(m);

    const mapa = new Map();
    const somar = (nome, mes, valor) => {
        if (!mapa.has(nome)) mapa.set(nome, Array(12).fill(0));
        mapa.get(nome)[mes] += valor;
    };
    let temEstorno = false;
    for (const t of linhas) {
        const mes = parseInt(String(t.competencia).slice(5, 7), 10) - 1;
        if (!(mes >= 0 && mes < 12)) continue;
        const valor = Number(t.valor) || 0;
        const estorno = t.tipo === 'entradas' && ehCredito(t.metodo);
        if (tipo === 'saidas') {
            if (t.tipo === 'saidas') {
                somar(agrupar === 'categoria' ? (t.categoria || '(sem categoria)') : _chaveMetodoAnual(t.metodo), mes, valor);
            } else if (estorno) {
                temEstorno = true;
                // Estorno abate a fatura do cartão (na visão por forma) ou vira uma linha própria (por categoria)
                somar(agrupar === 'categoria' ? '(−) Estornos no cartão' : _chaveMetodoAnual(t.metodo), mes, -valor);
            }
        } else if (t.tipo === 'entradas' && !estorno) {
            somar(agrupar === 'categoria' ? (t.categoria || '(sem categoria)') : _chaveMetodoAnual(t.metodo), mes, valor);
        }
    }
    const lista = [...mapa.entries()].map(([nome, meses]) => ({ nome, meses, total: meses.reduce((a, b) => a + b, 0) }))
        .filter(l => l.meses.some(v => Math.abs(v) > 0.004))
        .sort((a, b) => (a.nome.startsWith('(−)') ? 1 : 0) - (b.nome.startsWith('(−)') ? 1 : 0) || b.total - a.total);
    const totais = Array(12).fill(0);
    lista.forEach(l => l.meses.forEach((v, i) => { totais[i] += v; }));
    return { linhas: lista, totais, temEstorno };
}

function _corDoNomeAnual(nome) {
    const cores = (estadoApp.menus && estadoApp.menus.cores) || {};
    const mapa = estadoAnual.agrupar === 'categoria' ? cores.categoria : cores.metodo;
    return (mapa && mapa[nome]) || (typeof corPadraoChip === 'function' ? corPadraoChip(nome) : '#6366F1');
}

function _graficoBarrasAnual(totais) {
    const max = Math.max(...totais, 1);
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() === estadoAnual.ano ? hoje.getMonth() : -1;
    const largura = 600, alturaBarras = 110, base = 128, passo = largura / 12, bw = passo * 0.6;
    const cor = estadoAnual.tipo === 'entradas' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const barras = totais.map((v, i) => {
        const h = v > 0 ? Math.max(3, (v / max) * alturaBarras) : 0;
        const x = i * passo + (passo - bw) / 2;
        const atual = i === mesAtual;
        return `<g class="anual-barra" data-mes="${i}">
            <title>${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(v)}</title>
            <rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${cor}" opacity="${atual ? 1 : 0.55}"/>
            <text x="${(x + bw / 2).toFixed(1)}" y="146" text-anchor="middle" class="anual-eixo${atual ? ' atual' : ''}">${MESES_ANUAL[i]}</text>
        </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${largura} 154" class="anual-grafico" role="img" aria-label="Total por mês">
        <line x1="0" y1="${base}" x2="${largura}" y2="${base}" class="anual-base"/>${barras}</svg>`;
}

function _renderVisaoAnual() {
    const cont = document.getElementById('anualConteudo');
    if (!cont) return;
    const { linhas, totais, temEstorno } = _calcularVisaoAnual();
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() === estadoAnual.ano ? hoje.getMonth() : (estadoAnual.ano < hoje.getFullYear() ? 11 : -1);
    const totalAno = totais.reduce((a, b) => a + b, 0);
    const decorridos = mesAtual >= 0 ? mesAtual + 1 : 0;
    const media = decorridos ? totais.slice(0, decorridos).reduce((a, b) => a + b, 0) / decorridos : 0;
    const iMax = totais.reduce((im, v, i) => (v > totais[im] ? i : im), 0);
    const nomeTipo = estadoAnual.tipo === 'entradas' ? 'Receitas' : 'Despesas';

    // mês atual (ou último com dado) vs. anterior
    let ref = mesAtual >= 0 ? mesAtual : 0;
    const anterior = ref > 0 ? totais[ref - 1] : null;
    const varPct = anterior ? ((totais[ref] - anterior) / Math.abs(anterior)) * 100 : null;
    const varTxt = varPct === null ? '—' : `${varPct > 0 ? '▲' : varPct < 0 ? '▼' : ''} ${Math.abs(varPct).toFixed(0)}%`;
    // Para despesa, subir é ruim; para receita, subir é bom
    const bom = estadoAnual.tipo === 'entradas' ? varPct >= 0 : varPct <= 0;
    const classeVar = varPct === null || varPct === 0 ? '' : (bom ? 'bom' : 'ruim');

    const maxCel = Math.max(1, ...linhas.flatMap(l => l.meses.map(v => Math.abs(v))));
    const corHeat = estadoAnual.tipo === 'entradas' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const linhasHTML = linhas.map(l => {
        const negativa = l.nome.startsWith('(−)');
        const cel = l.meses.map((v, i) => {
            if (Math.abs(v) < 0.005) return `<td class="vazio">–</td>`;
            const forca = Math.round(8 + 42 * Math.min(1, Math.abs(v) / maxCel));
            return `<td class="cel${i === mesAtual ? ' atual' : ''}" style="background:color-mix(in srgb, ${negativa ? 'var(--receita-text)' : corHeat} ${forca}%, transparent)" title="${l.nome} · ${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(v)}">${_fmtCel(v)}</td>`;
        }).join('');
        const ponto = negativa ? '' : `<i class="anual-ponto" style="background:${_corDoNomeAnual(l.nome)}"></i>`;
        return `<tr><th scope="row" class="anual-nome">${ponto}<span>${l.nome}</span></th>${cel}<td class="total">${_fmtCel(l.total)}</td></tr>`;
    }).join('');

    const deltas = totais.map((v, i) => {
        if (i === 0 || !totais[i - 1] || (mesAtual >= 0 && i > mesAtual)) return `<td class="vazio">–</td>`;
        const p = ((v - totais[i - 1]) / Math.abs(totais[i - 1])) * 100;
        const b = estadoAnual.tipo === 'entradas' ? p >= 0 : p <= 0;
        return `<td class="delta ${Math.abs(p) < 0.5 ? '' : (b ? 'bom' : 'ruim')}">${p > 0 ? '+' : ''}${p.toFixed(0)}%</td>`;
    }).join('');

    cont.innerHTML = `
        <div class="anual-cards">
            <div class="anual-card"><span>${nomeTipo} no ano</span><b>${_fmtMoeda(totalAno)}</b></div>
            <div class="anual-card"><span>Média por mês</span><b>${_fmtMoeda(media)}</b></div>
            <div class="anual-card"><span>Maior mês</span><b>${totalAno ? `${MESES_ANUAL_LONGO[iMax]} · ${_fmtMoeda(totais[iMax])}` : '—'}</b></div>
            <div class="anual-card"><span>${MESES_ANUAL[ref]} vs. mês anterior</span><b class="${classeVar}">${varTxt}</b></div>
        </div>
        <div class="anual-grafico-wrap">${_graficoBarrasAnual(totais)}</div>
        ${linhas.length ? `
        <div class="anual-tabela-wrap">
            <table class="anual-tabela">
                <thead><tr><th class="anual-nome">${estadoAnual.agrupar === 'categoria' ? 'Categoria' : 'Forma de pgto.'}</th>
                    ${MESES_ANUAL.map((m, i) => `<th class="mes${i === mesAtual ? ' atual' : ''}"><button type="button" data-ir-mes="${i}" title="Ir para ${MESES_ANUAL_LONGO[i]}">${m}</button></th>`).join('')}
                    <th class="total">Total</th></tr></thead>
                <tbody>${linhasHTML}</tbody>
                <tfoot>
                    <tr class="tot"><th scope="row" class="anual-nome">Total</th>${totais.map((v, i) => `<td class="${i === mesAtual ? 'atual' : ''}">${v ? _fmtCel(v) : '–'}</td>`).join('')}<td class="total">${_fmtCel(totalAno)}</td></tr>
                    <tr class="var"><th scope="row" class="anual-nome">vs. mês anterior</th>${deltas}<td></td></tr>
                </tfoot>
            </table>
        </div>
        <p class="menu-hint anual-nota">Valores em R$ (sem centavos), pelo mês da competência${temEstorno ? '; estornos/reembolsos no cartão abatem a despesa' : ''}. Toque num mês para abri-lo.</p>`
        : `<p class="empty-message">Nada lançado em ${estadoAnual.ano}.</p>`}`;
}

/** Abre a aba, carrega o ano (só se ainda não carregado) e desenha. */
async function carregarVisaoAnual(forcar = false) {
    const cont = document.getElementById('anualConteudo');
    if (!cont) return;
    document.getElementById('anualAno').textContent = estadoAnual.ano;
    document.querySelectorAll('#anual [data-anual-tipo]').forEach(b => b.classList.toggle('active', b.dataset.anualTipo === estadoAnual.tipo));
    document.querySelectorAll('#anual [data-anual-agrupar]').forEach(b => b.classList.toggle('active', b.dataset.anualAgrupar === estadoAnual.agrupar));
    if (forcar || estadoAnual.anoCarregado !== estadoAnual.ano || !estadoAnual.linhas) {
        if (estadoAnual.carregando) return;
        estadoAnual.carregando = true;
        cont.innerHTML = '<p class="loading">Carregando o ano...</p>';
        try {
            estadoAnual.linhas = await _buscarTransacoesDoAno(estadoAnual.ano);
            estadoAnual.anoCarregado = estadoAnual.ano;
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

function iniciarVisaoAnual() {
    const aba = document.getElementById('anual');
    if (!aba) return;
    aba.addEventListener('click', async e => {
        const btnTipo = e.target.closest('[data-anual-tipo]');
        const btnAgr = e.target.closest('[data-anual-agrupar]');
        const btnAno = e.target.closest('[data-anual-ano]');
        const btnMes = e.target.closest('[data-ir-mes]');
        if (btnTipo) { estadoAnual.tipo = btnTipo.dataset.anualTipo; carregarVisaoAnual(); }
        else if (btnAgr) { estadoAnual.agrupar = btnAgr.dataset.anualAgrupar; carregarVisaoAnual(); }
        else if (btnAno) { estadoAnual.ano += Number(btnAno.dataset.anualAno); carregarVisaoAnual(); }
        else if (btnMes) {
            // Leva o app pro mês tocado e fecha a visão anual
            estadoApp.mesAtual = new Date(estadoAnual.ano, Number(btnMes.dataset.irMes), 1);
            if (typeof fecharAbas === 'function') fecharAbas();
            if (typeof recarregarDados === 'function') await recarregarDados();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
}

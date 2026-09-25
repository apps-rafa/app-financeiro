/**
 * LIXEIRA
 * Lançamentos excluídos ficam 30 dias aqui (tabela `lixeira`, um snapshot da
 * linha de `transacoes`) e podem ser restaurados. Passados 30 dias somem
 * sozinhos (limpeza ao abrir a lixeira).
 */

const DIAS_LIXEIRA = 30;
let _lixeiraBuscaCache = null; // { ts, itens } — só pra busca universal

/** Itens da lixeira (últimos 30 dias) que batem com o termo — a busca
 *  universal usa isso; guarda em cache por alguns segundos. */
async function buscarLixeira(termo) {
    if (!_lixeiraBuscaCache || Date.now() - _lixeiraBuscaCache.ts > 15000) {
        const limite = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
        const { data, error } = await sb.from('lixeira').select('*')
            .gte('excluido_em', limite).order('excluido_em', { ascending: false });
        if (error) { console.error(error); return []; }
        _lixeiraBuscaCache = { ts: Date.now(), itens: data || [] };
    }
    const planos = _lixeiraBuscaCache.itens.map(i => ({ ...(i.dados || {}), formaPagamento: (i.dados || {}).forma_pagamento, _item: i }));
    return _filtrarPorBusca(planos, termo).map(p => p._item);
}

/** HTML de um item da lixeira (usado na aba Lixeira e no resultado da busca). */
function htmlItemLixeira(item) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const dd = iso => { const [, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}`; };
    const t = item.dados || {};
    const dias = Math.min(DIAS_LIXEIRA, Math.max(0, DIAS_LIXEIRA - Math.floor(Math.max(0, Date.now() - new Date(item.excluido_em)) / 86400000)));
    const parcela = t.parcelas_total > 1 ? ` <span class="parcela-tag">${t.parcela_num}/${t.parcelas_total}</span>` : '';
    return `
    <div class="lixeira-item">
        <div class="lixeira-info">
            <div class="lixeira-linha1">
                <b class="lixeira-valor ${t.tipo === 'entradas' ? 'receita' : 'despesa'}">${t.tipo === 'entradas' ? '+' : '−'} ${formatarMoeda(Number(t.valor) || 0)}</b>
                <span class="lixeira-desc">${esc(t.descricao) || esc(t.categoria)}</span>${parcela}
            </div>
            <div class="lixeira-linha2">
                ${dd(t.data)} · ${esc(t.categoria)}${t.metodo ? ' · ' + esc(t.metodo) : ''}
            </div>
            <div class="lixeira-linha3">excluído em ${dd(item.excluido_em)} (some em ${dias} d)</div>
        </div>
        <div class="lixeira-acoes">
            <button type="button" class="mini-btn" data-lixeira-restaurar="${item.id}" title="Restaurar este lançamento" aria-label="Restaurar">↩</button>
            <button type="button" class="mini-btn" data-lixeira-apagar="${item.id}" title="Apagar de vez" aria-label="Apagar de vez">✕</button>
        </div>
    </div>`;
}

/** Guarda cópia das linhas ANTES de apagá-las de `transacoes`. */
async function moverParaLixeira(linhas) {
    if (!linhas || !linhas.length) return;
    _lixeiraBuscaCache = null;
    const { error } = await sb.from('lixeira').insert(linhas.map(dados => ({ dados })));
    if (error) throw error;
}

let _lixeiraQtd = 5; // quantos itens a aba Lixeira mostra (5 por vez, "Carregar mais")
async function carregarLixeira(qtd) {
    _lixeiraQtd = qtd || (_lixeiraMantem ? _lixeiraQtd : 5);
    _lixeiraMantem = false;
    const box = document.getElementById('lixeiraLista');
    if (!box) return;
    box.innerHTML = '<p class="empty-message">Carregando...</p>';

    const limite = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
    // Limpeza do que passou de 30 dias (falha aqui não impede de listar).
    const { error: errLimpa } = await sb.from('lixeira').delete().lt('excluido_em', limite);
    if (errLimpa) console.error(errLimpa);

    const { data, error } = await sb.from('lixeira').select('*')
        .gte('excluido_em', limite).order('excluido_em', { ascending: false });
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty-message">Erro ao carregar a lixeira</p>';
        return;
    }
    if (!data.length) {
        box.innerHTML = `<p class="empty-message">Nada excluído nos últimos ${DIAS_LIXEIRA} dias</p>`;
        box.onclick = null;
        return;
    }

    box.innerHTML = data.slice(0, _lixeiraQtd).map(htmlItemLixeira).join('')
        + (data.length > _lixeiraQtd ? `<button type="button" class="busca-ampla-btn" data-lixeira-mais>Carregar mais 5</button>` : '');
    box.onclick = onCliqueLixeira;
}

let _lixeiraMantem = false;
async function onCliqueLixeira(e) {
    _lixeiraBuscaCache = null;
    if (e.target.closest('[data-lixeira-mais]')) { carregarLixeira(_lixeiraQtd + 5); return; }
    _lixeiraMantem = true; // restaurar/apagar recarregam mantendo a quantidade já aberta
    const btnR = e.target.closest('[data-lixeira-restaurar]');
    const btnA = e.target.closest('[data-lixeira-apagar]');
    if (btnR) {
        btnR.disabled = true;
        try {
            const id = Number(btnR.dataset.lixeiraRestaurar);
            const { data: item, error } = await sb.from('lixeira').select('dados').eq('id', id).single();
            if (error) throw error;
            const { id: _i, user_id, criado_em, ...resto } = item.dados;
            const { error: e2 } = await sb.from('transacoes').insert(resto);
            if (e2) throw e2;
            const { error: e3 } = await sb.from('lixeira').delete().eq('id', id);
            if (e3) throw e3;
            mostrarNotificacao('↩ Lançamento restaurado', 'sucesso');
            if (typeof recarregarDados === 'function') await recarregarDados();
            carregarLixeira();
            if (typeof atualizarBuscaGlobal === 'function') atualizarBuscaGlobal();
        } catch (err) {
            console.error('Erro ao restaurar:', err);
            mostrarNotificacao('Erro ao restaurar o lançamento', 'erro');
            btnR.disabled = false;
        }
    } else if (btnA) {
        const id = Number(btnA.dataset.lixeiraApagar);
        const { error } = await sb.from('lixeira').delete().eq('id', id);
        if (error) { console.error(error); mostrarNotificacao('Erro ao apagar', 'erro'); return; }
        carregarLixeira();
        if (typeof atualizarBuscaGlobal === 'function') atualizarBuscaGlobal();
    }
}

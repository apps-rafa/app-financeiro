/**
 * LIXEIRA
 * Lançamentos excluídos ficam 30 dias aqui (tabela `lixeira`, um snapshot da
 * linha de `transacoes`) e podem ser restaurados. Passados 30 dias somem
 * sozinhos (limpeza ao abrir a lixeira).
 */

const DIAS_LIXEIRA = 30;

/** Guarda cópia das linhas ANTES de apagá-las de `transacoes`. */
async function moverParaLixeira(linhas) {
    if (!linhas || !linhas.length) return;
    const { error } = await sb.from('lixeira').insert(linhas.map(dados => ({ dados })));
    if (error) throw error;
}

async function carregarLixeira() {
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

    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const dd = iso => { const [, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}`; };
    box.innerHTML = data.map(item => {
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
                    ${dd(t.data)} · ${esc(t.categoria)}${t.metodo ? ' · ' + esc(t.metodo) : ''} ·
                    excluído em ${dd(item.excluido_em)} (some em ${dias} d)
                </div>
            </div>
            <div class="lixeira-acoes">
                <button type="button" class="mini-btn" data-lixeira-restaurar="${item.id}" title="Restaurar este lançamento">↩ Restaurar</button>
                <button type="button" class="mini-btn" data-lixeira-apagar="${item.id}" title="Apagar de vez" aria-label="Apagar de vez">✕</button>
            </div>
        </div>`;
    }).join('');
    box.onclick = onCliqueLixeira;
}

async function onCliqueLixeira(e) {
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
    }
}

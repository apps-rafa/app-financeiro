/**
 * LANÇAMENTOS RECORRENTES — "🔁 Repetir todo mês" num lançamento cria um modelo
 * (tabela `recorrentes`); no dia do mês o bot do Telegram manda o lembrete já
 * com o lançamento preenchido pra confirmar com um toque (ver
 * supabase/functions/telegram-webhook: executarLembretes). Nada é lançado
 * sozinho. A lista fica em Configurações > Notificações.
 */

const _escRec = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Abre o diálogo pra criar um recorrente a partir de um lançamento existente. */
function abrirRepetirMensal(trans, tipo) {
    const diaPadrao = parseInt(String(trans.data).slice(8, 10), 10) || 1;
    const valorTxt = String(trans.valor).replace('.', ',');
    mostrarDialogo({
        titulo: '🔁 Repetir todo mês',
        corpoHTML: `
            <p class="menu-hint">No dia escolhido eu te lembro pelo Telegram, com o lançamento pronto pra confirmar.</p>
            <div class="campo"><label for="dlgRecDesc">Descrição</label>
                <input type="text" id="dlgRecDesc" value="${_escRec(trans.descricao || '')}" autocomplete="off"></div>
            <div class="campo"><label for="dlgRecValor">Valor (R$)</label>
                <input type="text" id="dlgRecValor" inputmode="decimal" value="${valorTxt}" autocomplete="off"></div>
            <div class="campo"><label for="dlgRecDia">Dia do mês</label>
                <input type="text" id="dlgRecDia" inputmode="numeric" maxlength="2" value="${diaPadrao}" autocomplete="off"></div>
            <p class="menu-hint">${_escRec(trans.categoria || '')}${trans.metodo ? ` · ${_escRec(trans.metodo)}` : ''}. Em meses mais curtos vale o último dia.</p>`,
        acoes: [
            { label: 'Cancelar' },
            { label: 'Repetir', primario: true, onClick: async (ov) => {
                const valor = parseFloat(String(ov.querySelector('#dlgRecValor').value).replace(/\./g, '').replace(',', '.'));
                const dia = parseInt(ov.querySelector('#dlgRecDia').value, 10);
                if (!(valor > 0)) { mostrarNotificacao('Informe um valor maior que zero', 'info'); return true; }
                if (!(dia >= 1 && dia <= 31)) { mostrarNotificacao('Dia do mês inválido', 'info'); return true; }
                const { error } = await sb.from('recorrentes').insert({
                    descricao: ov.querySelector('#dlgRecDesc').value.trim(),
                    tipo, valor, categoria: trans.categoria, metodo: trans.metodo || null, dia_mes: dia,
                });
                if (error) { console.error(error); mostrarNotificacao('Erro ao criar o recorrente', 'erro'); return true; }
                mostrarNotificacao('Recorrente criado — lembrete todo dia ' + dia, 'sucesso');
                if (typeof carregarRecorrentes === 'function') carregarRecorrentes();
            } },
        ],
    });
}

/** Lista os recorrentes (Configurações > Notificações). */
async function carregarRecorrentes() {
    const box = document.getElementById('recorrentesLista');
    if (!box) return;
    const { data, error } = await sb.from('recorrentes').select('*').order('dia_mes').order('id');
    if (error) { console.error(error); box.innerHTML = '<p class="empty-text">Erro ao carregar os recorrentes</p>'; return; }
    if (!data || !data.length) {
        box.innerHTML = '<p class="empty-text">Nenhum ainda — toque em 🔁 num lançamento pra repeti-lo todo mês.</p>';
        box.onclick = null;
        return;
    }
    const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    box.innerHTML = data.map(r => `
        <div class="recorrente-item${r.ativo ? '' : ' pausado'}">
            <div class="recorrente-info">
                <b>${_escRec(r.descricao || r.categoria)}</b>
                <span>${r.tipo === 'entradas' ? '+' : '-'} ${brl.format(Number(r.valor))} · todo dia ${r.dia_mes}${r.metodo ? ` · ${_escRec(r.metodo)}` : ''} · ${_escRec(r.categoria)}</span>
            </div>
            <div class="recorrente-acoes">
                <button type="button" class="mini-btn" data-rec-alternar="${r.id}" data-ativo="${r.ativo ? 1 : 0}">${r.ativo ? 'Pausar' : 'Ativar'}</button>
                <button type="button" class="btn-icon btn-danger" data-rec-apagar="${r.id}" title="Apagar">🗑️</button>
            </div>
        </div>`).join('');
    box.onclick = async e => {
        const alt = e.target.closest('[data-rec-alternar]');
        const del = e.target.closest('[data-rec-apagar]');
        if (alt) {
            const { error: err } = await sb.from('recorrentes').update({ ativo: alt.dataset.ativo !== '1' }).eq('id', Number(alt.dataset.recAlternar));
            if (err) mostrarNotificacao('Erro ao atualizar', 'erro');
            carregarRecorrentes();
        } else if (del) {
            const { error: err } = await sb.from('recorrentes').delete().eq('id', Number(del.dataset.recApagar));
            if (err) mostrarNotificacao('Erro ao apagar', 'erro');
            else mostrarNotificacao('Recorrente apagado', 'sucesso');
            carregarRecorrentes();
        }
    };
}

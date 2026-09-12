/**
 * FUNÇÕES UTILITÁRIAS
 * Formatação, validação, notificações
 */

/**
 * Formata um valor numérico como moeda brasileira
 */
function formatarMoeda(valor) {
    const n = Number(valor) || 0;
    const semCentavos = Math.round(n * 100) % 100 === 0;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: semCentavos ? 0 : 2,
        maximumFractionDigits: 2
    }).format(n);
}

/**
 * Formata uma data para o padrão português
 */
function formatarData(dataStr) {
    const data = new Date(dataStr);
    return data.toLocaleDateString('pt-BR');
}

/**
 * Calcula dias até uma data
 */
function calcularDiasAte(dataStr) {
    const data = new Date(dataStr);
    const hoje = new Date();
    const diferenca = data - hoje;
    return Math.ceil(diferenca / (1000 * 60 * 60 * 24));
}

/**
 * Valida se um campo está preenchido
 */
function validarCampo(valor) {
    return valor !== null && valor !== undefined && valor.toString().trim() !== '';
}

/**
 * Valida um formulário de transação
 */
function validarFormularioTransacao(dados) {
    // Receita (entradas) não tem método
    const rotulo = { data: 'a data', valor: 'o valor', metodo: 'o método', categoria: 'a categoria' };
    const obrig = dados.tipo === 'saidas'
        ? ['data', 'valor', 'metodo', 'categoria']
        : ['data', 'valor', 'categoria'];

    for (const campo of obrig) {
        if (!validarCampo(dados[campo])) {
            return { valido: false, erro: `Preencha ${rotulo[campo] || campo}` };
        }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) {
        return { valido: false, erro: 'Data inválida — use dd/mm' };
    }

    if (isNaN(parseFloat(dados.valor)) || parseFloat(dados.valor) <= 0) {
        return { valido: false, erro: 'O valor precisa ser maior que zero' };
    }

    // Contas / Parcelada: dia do vencimento (o campo já vem pré-preenchido).
    // Competência não é pedida: no crédito ela sai da data + fechamento do cartão.
    if ((dados.tipoRecorrencia === 'Mensal' || dados.tipoRecorrencia === 'Parcelada')
        && !(parseInt(dados.diaRecorrencia, 10) >= 1 && parseInt(dados.diaRecorrencia, 10) <= 31)) {
        return { valido: false, erro: 'Informe o dia do vencimento (1 a 31)' };
    }

    if (dados.tipoRecorrencia === 'Parcelada' && !(parseInt(dados.parcelas, 10) >= 1)) {
        return { valido: false, erro: 'Informe em quantas parcelas' };
    }

    if (dados.tipoRecorrencia === 'Semanal' && dados.diaSemana !== '' && dados.diaSemana != null
        && !(dados.semanas && dados.semanas.length >= 1)) {
        return { valido: false, erro: 'Marque pelo menos uma semana' };
    }

    return { valido: true };
}

// ===== Máscaras / conversão de datas (dd/mm — o ano vem do mês em exibição) =====

const MESES_TRI = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
/** número do mês (1-12 ou '01'..'12') -> tricode "SET" */
function mesTri(m) { return MESES_TRI[(parseInt(m, 10) || 0) - 1] || ''; }

/**
 * Máscara dd/mm (sem ano — ele já está definido no mês em exibição).
 * - Ao DIGITAR: insere a "/" e preserva a posição do cursor.
 * - Ao APAGAR: não reinsere a "/" nem reformata (evita a barra "pular pra
 *   frente"). A "/" volta sozinha quando o usuário digitar de novo.
 */
function mascaraDataBR(input) {
    const original = input.value;
    const digitos = original.replace(/\D/g, '').slice(0, 4);
    const anteriores = input.dataset.qtdDigitos ? +input.dataset.qtdDigitos : digitos.length;
    input.dataset.qtdDigitos = String(digitos.length);

    if (digitos.length < anteriores) {
        const limpo = original.replace(/[^\d/]/g, '').replace(/\/{2,}/g, '/').slice(0, 5);
        if (limpo !== original) input.value = limpo;
        return;
    }

    const caret = (input.selectionStart != null) ? input.selectionStart : original.length;
    const digitosAntesDoCaret = original.slice(0, caret).replace(/\D/g, '').length;

    let out = digitos;
    if (digitos.length > 2) out = digitos.slice(0, 2) + '/' + digitos.slice(2);
    if (out === original) return;
    input.value = out;

    let pos = 0, vistos = 0;
    while (pos < out.length && vistos < digitosAntesDoCaret) {
        const c = out.charCodeAt(pos);
        if (c >= 48 && c <= 57) vistos++;
        pos++;
    }
    try { input.setSelectionRange(pos, pos); } catch (_) {}
}

/** 'YYYY-MM-DD' -> 'dd/mm' */
function isoParaDiaMes(iso) {
    const m = String(iso).slice(0, 10).match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${m[2]}/${m[1]}` : '';
}

/** 'dd/mm' (ano = mês em exibição) ou 'dd/mm/aaaa' -> 'YYYY-MM-DD' (ou '') */
function dataCampoParaISO(valor) {
    const s = String(valor || '').trim();
    const curto = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (curto) {
        const ano = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual)
            ? estadoApp.mesAtual.getFullYear() : new Date().getFullYear();
        return parseDataBR(`${curto[1]}/${curto[2]}/${ano}`);
    }
    return parseDataBR(s);
}

/** Data padrão do formulário: dia de hoje + MÊS EM EXIBIÇÃO, como 'dd/mm'
 *  (o ano fica no seletor de mês do topo). */
function dataPadraoDiaMes() {
    const hoje = new Date();
    const ref = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual) ? estadoApp.mesAtual : hoje;
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
    const dia = Math.min(hoje.getDate(), ultimo);
    return `${String(dia).padStart(2, '0')}/${String(ref.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Aplica a data padrão no campo #data.
 * force=true: sempre (limpar formulário, carga inicial, troca de tipo).
 * force=false: só se o usuário ainda não mexeu no campo (ex.: navegou de mês).
 */
function aplicarDataPadrao(force) {
    const el = document.querySelector(SELECTORS.data);
    if (!el) return;
    if (typeof estadoApp !== 'undefined' && estadoApp.editandoId) return;
    // Campo travado (readOnly) nunca foi digitado pelo usuário — o valor ali é
    // sempre calculado (vencimento do cartão, próximo dia útil etc.), então
    // sempre pode ser recalculado pro mês novo, mesmo sem force=true.
    if (!force && !el.readOnly && el.value && el.value !== el.dataset.padrao) return;
    const nova = dataPadraoDiaMes();
    el.value = nova;
    el.dataset.padrao = nova;
    el.dataset.qtdDigitos = String((nova.match(/\d/g) || []).length);
    delete el.dataset.userVal;
    if (typeof recalcularCompetencia === 'function') recalcularCompetencia();
    // Recorrência/cartão de crédito: refaz o vencimento travado (dia do cartão)
    // em cima do novo mês em exibição.
    if (typeof atualizarCamposRecorrencia === 'function') atualizarCamposRecorrencia();
}

/** Liga a máscara de data num input: keydown (backspace na "/") + sincroniza o
 *  contador de dígitos ao focar (o valor pode ter sido setado por código). */
function ligarCampoData(input) {
    if (!input || input.dataset.dataLigado) return;
    input.dataset.dataLigado = '1';
    input.addEventListener('keydown', mascaraDataKeydown);
    input.addEventListener('focus', () => {
        input.dataset.qtdDigitos = String((input.value.match(/\d/g) || []).length);
    });
}

/** keydown p/ campos de data: Backspace logo depois de uma "/" apaga o dígito antes dela */
function mascaraDataKeydown(e) {
    const input = e.target;
    if (e.key !== 'Backspace') return;
    if (input.selectionStart !== input.selectionEnd || input.selectionStart < 2) return;
    if (input.value[input.selectionStart - 1] !== '/') return;
    e.preventDefault();
    const p = input.selectionStart;
    input.value = input.value.slice(0, p - 2) + input.value.slice(p - 1); // tira o dígito, mantém a "/"
    try { input.setSelectionRange(p - 2, p - 2); } catch (_) {}
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 'dd/mm/aaaa' ou 'dd/mm/aa' -> 'YYYY-MM-DD' (ou '' se incompleto/ inválido) */
function parseDataBR(str) {
    const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return '';
    let [, d, mo, y] = m;
    d = +d; mo = +mo; y = +y;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' -> 'dd/mm/aaaa' */
function isoParaDataBR(iso) {
    const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function dataHojeBR() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Mantém um input só com dígitos, limitado a `max` caracteres */
function soNumeros(input, max) {
    input.value = input.value.replace(/\D/g, '').slice(0, max);
}

/**
 * Diálogo modal simples (sem alert/confirm nativos).
 * @param {{titulo?:string, texto:string, acoes?:Array<{label:string, primario?:boolean, onClick?:Function}>}}
 */
function mostrarDialogo({ titulo, texto, corpoHTML, acoes }) {
    const ov = document.createElement('div');
    ov.className = 'dialogo-overlay';
    ov.innerHTML = `
        <div class="dialogo">
            ${titulo ? `<h3>${titulo}</h3>` : ''}
            ${texto ? `<p>${texto}</p>` : ''}
            ${corpoHTML ? `<div class="dialogo-corpo">${corpoHTML}</div>` : ''}
            <div class="dialogo-acoes"></div>
        </div>`;
    const fechar = () => ov.remove();
    const box = ov.querySelector('.dialogo-acoes');
    (acoes && acoes.length ? acoes : [{ label: 'OK' }]).forEach(a => {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.className = a.perigo ? 'btn-perigo' : (a.primario ? 'btn-add' : 'btn-cancelar');
        b.onclick = async () => {
            // onClick recebe (ov, fechar); se retornar true, mantém o diálogo aberto
            const manter = a.onClick ? await a.onClick(ov, fechar) : false;
            if (manter !== true) fechar();
        };
        box.appendChild(b);
    });
    ov.addEventListener('click', e => { if (e.target === ov) fechar(); });
    document.body.appendChild(ov);
    const primeiro = ov.querySelector('.dialogo-corpo input, .dialogo-corpo select');
    if (primeiro) primeiro.focus();
    return ov;
}

/** Máscara mm/aaaa */
function mascaraCompetencia(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 6);
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v;
}

/** 'mm/aaaa' -> 'YYYY-MM-01' (ou '') */
function parseCompetencia(str) {
    const m = String(str).trim().match(/^(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    const mo = +m[1];
    if (mo < 1 || mo > 12) return '';
    return `${m[2]}-${String(mo).padStart(2, '0')}-01`;
}

/** 'YYYY-MM-01' -> 'mm/aaaa' */
function competenciaParaBR(iso) {
    const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})/);
    return m ? `${m[2]}/${m[1]}` : '';
}

/** 'YYYY-MM-01' -> 'MM' (só o mês) */
function mesDeCompetencia(iso) {
    const m = String(iso).slice(0, 10).match(/^\d{4}-(\d{2})/);
    return m ? m[1] : '';
}

/** 'MM' (mês) + ano do mês em exibição -> 'YYYY-MM-01' (ou '') */
function competenciaDeMes(mm) {
    const mo = parseInt(String(mm).replace(/\D/g, ''), 10);
    if (!(mo >= 1 && mo <= 12)) return '';
    const ano = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual)
        ? estadoApp.mesAtual.getFullYear()
        : new Date().getFullYear();
    return `${ano}-${String(mo).padStart(2, '0')}-01`;
}

/** Máscara de mês: só números, 2 dígitos */
function mascaraMes(input) {
    input.value = input.value.replace(/\D/g, '').slice(0, 2);
}

/**
 * Mostra notificação na tela
 */
function mostrarNotificacao(mensagem, tipo = 'sucesso') {
    const notif = document.createElement('div');
    const cores = {
        sucesso: '#10B981',
        erro: '#EF4444',
        info: '#3B82F6'
    };
    
    const cor = cores[tipo] || cores.info;
    
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, ${cor}, ${cor}99);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        animation: slideInDown 0.3s ease;
        font-weight: 600;
    `;
    notif.textContent = mensagem;
    
    document.body.appendChild(notif);
    
    // Remover após tempo configurado
    setTimeout(() => {
        notif.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => notif.remove(), CONFIG.ANIMACAO_DURACAO);
    }, CONFIG.NOTIFICACAO_DURACAO);
}

/**
 * Obtém mês/ano formatados
 */
function obterMesAnoFormatado(data) {
    const opcoes = { month: 'long', year: 'numeric' };
    const mesFormatado = data.toLocaleDateString('pt-BR', opcoes);
    return mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);
}

/** Versão curta: "SET/2026" (para telas estreitas) */
function obterMesAnoCurto(data) {
    const m = data.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
    return `${m}/${data.getFullYear()}`;
}

/** Versão mínima: "09/26" (para telas muito estreitas) */
function obterMesAnoMini(data) {
    const mm = String(data.getMonth() + 1).padStart(2, '0');
    return `${mm}/${String(data.getFullYear()).slice(-2)}`;
}

/**
 * Debounce para evitar múltiplas chamadas
 */
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
}

/**
 * Delay assíncrono
 */
function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Adiciona CSS dinamicamente
 */
function adicionarCSSDinamico(css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Limpa o formulário de transação
 */
function limparFormulario() {
    const form = document.querySelector(SELECTORS.formTransacao);
    if (form) {
        form.reset();
        aplicarDataPadrao(true);
        // Tipo volta para "Despesa" — e os BOTÕES acompanham (evita botão dizer
        // "Receita" enquanto os campos mostram "Despesa")
        document.querySelector(SELECTORS.tipoTransacao).value = 'saidas';
        if (typeof estadoApp !== 'undefined') estadoApp.tipoAtual = 'saidas';
        document.querySelectorAll('.tipo-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tipo === 'saidas'));
        const pv = document.getElementById('pagarVencimento');
        if (pv) pv.checked = false;
        const dataEl = document.querySelector(SELECTORS.data);
        if (dataEl) delete dataEl.dataset.userVal;
        if (typeof semanasMarcadas !== 'undefined') semanasMarcadas = new Set();
        const btnSub = document.querySelector('.btn-submit');
        if (btnSub && !estadoApp.editandoId) btnSub.textContent = 'Adicionar';
        if (typeof preencherDropdownRecorrencias === 'function') preencherDropdownRecorrencias();
        if (typeof atualizarCamposRecorrencia === 'function') atualizarCamposRecorrencia();
        if (typeof atualizarLabelsPorTipo === 'function') atualizarLabelsPorTipo();
        if (typeof atualizarCampoCredito === 'function') atualizarCampoCredito();
    }
}

/**
 * Obtém dados do formulário
 */
function obterDadosFormulario() {
    const tipoRecorrencia = document.querySelector(SELECTORS.tipoRecorrencia).value;
    const diaRecorrencia = document.getElementById('diaRecorrencia')?.value || '';

    // "Dia útil fixo": competência (mês) vem do próprio grupo; senão, do campo de Crédito
    const ehDiaUtil = typeof RECORRENCIA_DIA_UTIL !== 'undefined'
        && RECORRENCIA_DIA_UTIL.includes(tipoRecorrencia);

    const ehEntrada = document.querySelector(SELECTORS.tipoTransacao).value === 'entradas';
    const mesExib = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual)
        ? formatarDataISO(estadoApp.mesAtual) : hojeISO();

    // Semanal não tem campo de data: usa a 1ª semana marcada (ou o mês em exibição)
    const semanasSel = typeof semanasMarcadas !== 'undefined' ? [...semanasMarcadas].sort() : [];
    let dataISO = dataCampoParaISO(document.querySelector(SELECTORS.data).value);

    // O select "Comp." só é populado/mostrado pra despesa no cartão de crédito
    // (ver atualizarCampoCredito, em js/ui.js) — pra qualquer outro método ele
    // nunca foi tocado e fica preso na 1ª <option> ("01"/Janeiro) do HTML. Ler
    // esse valor fora do contexto de crédito jogava a competência pra Janeiro
    // de qualquer lançamento (Dinheiro, PIX, Semanal, Pontual sem cartão...).
    const _met = typeof metodoSelecionado === 'function' ? metodoSelecionado() : null;
    const ehCreditoDespesa = !ehEntrada && !!_met && _met.metodoKind === 'Crédito';

    let compISO = ehDiaUtil
        ? competenciaDeMes(document.getElementById('compRecorrente')?.value || '')
        : (ehCreditoDespesa ? competenciaDeMes(document.getElementById('competencia')?.value || '') : '');
    if (tipoRecorrencia === 'Semanal') {
        dataISO = semanasSel[0] || mesExib;
    } else if (ehEntrada && (tipoRecorrencia === 'Mensal' || tipoRecorrencia === 'Parcelada')) {
        // Receita Mensal/Parcelada: competência = mês em exibição; data = próximo dia útil
        compISO = mesExib.slice(0, 8) + '01';
        dataISO = dataReceitaMensal(compISO, diaRecorrencia);
    }

    // Crédito à vista (Pontual): a competência é sempre derivada da data da
    // compra + fechamento do cartão — nunca depende de campo obrigatório.
    // Mensal/Parcelada não entra aqui: ali a "Data" já é o vencimento travado
    // (não a data da compra), então competência já veio certa do campo
    // "Comp." (calculada em cima do mês em exibição, não da data travada —
    // senão o fechamento seria aplicado 2x e a competência pularia de mês).
    const _comDiaCredito = tipoRecorrencia === 'Mensal' || tipoRecorrencia === 'Parcelada';
    if (ehCreditoDespesa && dataISO && !ehDiaUtil && !_comDiaCredito) {
        compISO = competenciaDe(dataISO, _met.diaFechamento || null);
    }
    // Última rede: se ainda não há competência, usa o mês em exibição
    if (!compISO) compISO = mesExib.slice(0, 8) + '01';

    return {
        tipo: document.querySelector(SELECTORS.tipoTransacao).value,
        data: dataISO,
        valor: parseFloat(document.querySelector(SELECTORS.valor).value),
        metodo: document.querySelector(SELECTORS.metodo).value,
        categoria: document.querySelector(SELECTORS.categoria).value,
        formaPagamento: tipoRecorrencia === 'Parcelada' ? 'Parcelada' : 'À vista',
        tipoRecorrencia,
        diaRecorrencia,
        pagarVencimento: !!document.getElementById('pagarVencimento')?.checked,
        diaSemana: document.getElementById('diaSemana')?.value ?? '',
        semanas: semanasSel,
        valorSessao: parseFloat(document.querySelector(SELECTORS.valor).value) || 0,
        parcelas: parseInt(document.getElementById('parcelas')?.value, 10) || 1,
        competencia: compISO || '',
        descricao: document.querySelector(SELECTORS.descricao).value
    };
}

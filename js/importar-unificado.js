/**
 * IMPORTAR (unificado)
 * A aba CSV e a aba PDF de "Importar" cada uma tem um único dropdown de
 * formato (obrigatório escolher) em vez de duas seções separadas —
 * dependendo do formato escolhido, monta a tela de criar lançamentos
 * (só existe pra "minha planilha") ou a de conciliar (comparar com o que
 * já está no app), sem nunca misturar CSV com PDF.
 */

// Lembrado entre remontagens da aba (ex.: sair pra Despesas e voltar pra
// Configurações refaz o HTML do zero — sem isso o <select> voltava sempre
// pra "Selecione..." e o trabalho de conciliação/importação em andamento
// desaparecia de vista, mesmo o estado em si sobrevivendo em memória.
let _formatoImportCsvLembrado = '';
let _formatoImportPdfLembrado = '';
let _modoImportLembrado = 'csv';

function iniciarImportarUnificado() {
    const selCsv = document.getElementById('importCsvFormato');
    const selPdf = document.getElementById('importPdfFormato');

    if (selCsv) {
        if (_formatoImportCsvLembrado && [...selCsv.options].some(o => o.value === _formatoImportCsvLembrado)) {
            selCsv.value = _formatoImportCsvLembrado;
        }
        selCsv.addEventListener('change', () => {
            _formatoImportCsvLembrado = selCsv.value;
            _montarImportCSV(selCsv.value);
        });
        _formatoImportCsvLembrado = selCsv.value;
        _montarImportCSV(selCsv.value);
    }
    if (selPdf) {
        if (_formatoImportPdfLembrado && [...selPdf.options].some(o => o.value === _formatoImportPdfLembrado)) {
            selPdf.value = _formatoImportPdfLembrado;
        }
        selPdf.addEventListener('change', () => {
            _formatoImportPdfLembrado = selPdf.value;
            _montarImportPDF(selPdf.value);
        });
        _formatoImportPdfLembrado = selPdf.value;
        _montarImportPDF(selPdf.value);
    }

    if (_modoImportLembrado !== 'csv') {
        document.querySelectorAll('.importar-toggle-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.importarModo === _modoImportLembrado));
        document.querySelectorAll('[data-importar-modo]:not(.importar-toggle-btn)').forEach(el => {
            el.hidden = el.dataset.importarModo !== _modoImportLembrado;
        });
    }
    document.querySelectorAll('.importar-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => { _modoImportLembrado = btn.dataset.importarModo; });
    });
}

function _semFormatoEscolhido() {
    return `<p class="menu-hint">Escolha um formato acima pra continuar.</p>`;
}

function _montarImportCSV(formato) {
    const cont = document.getElementById('importCsvConteudo');
    if (!cont) return;

    if (!formato) { cont.innerHTML = _semFormatoEscolhido(); return; }

    if (formato === 'pessoal') {
        cont.innerHTML = `<div id="secImportarCSV"></div>`;
        if (typeof iniciarImportarCSV === 'function') iniciarImportarCSV();
        return;
    }

    cont.innerHTML = `<div id="secConciliarCSV"></div>`;
    if (typeof _iniciarConciliar === 'function') {
        _iniciarConciliar('secConciliarCSV', 'csv', formato === 'nubank' ? 'nubank' : 'mp');
    }
}

function _montarImportPDF(formato) {
    const cont = document.getElementById('importPdfConteudo');
    if (!cont) return;

    if (!formato) { cont.innerHTML = _semFormatoEscolhido(); return; }

    cont.innerHTML = `<div id="secConciliarPDF"></div>`;
    if (typeof _iniciarConciliar === 'function') {
        _iniciarConciliar('secConciliarPDF', 'pdf', formato === 'bradesco' ? 'bradesco' : 'mp');
    }
}

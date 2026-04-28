const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

chromium.use(stealth);

// --- CONFIGURAÇÃO DE USUÁRIOS (Ordem: Gabriel -> Esther -> Luhan) ---
const USERS = [
    { email: 'gabriel.silva@transcleber.com.br', pass: 'Gabr2312!*' },
    { email: 'maria.esther@transcleber.com.br', pass: 'TheraJob@7' },
    { email: 'luhan.vinicius@transcleber.com.br', pass: 'Luhan123@@' }
];

// --- CONFIGURAÇÃO DE FILIAIS ---
const FILIAIS = [
    { nome: 'FORTALEZA', pasta: 'FOR' },
    { nome: 'IMPERATRIZ', pasta: 'IMP' },
    { nome: 'JUAZEIRO', pasta: 'JUA' },
    { nome: 'SÃO LUÍS', pasta: 'SLZ' },
    { nome: 'SOBRAL', pasta: 'SOB' },
    { nome: 'TERESINA', pasta: 'THE' }
];

// --- CONFIGURAÇÃO DE CAMINHOS ---
const BASE_REPORT_PATH = process.env.BASE_REPORT_PATH || (process.platform === 'win32' 
    ? 'C:\\Users\\luhan.vinicius\\grupojb.log.br\\tc - DATABASE PAINEL\\BASE FISCAL'
    : '/home/luhan/base_fiscal'); // Ajuste conforme necessário para o Ubuntu

async function run(userIndex = 0, cdIndex = 0) {
    if (userIndex >= USERS.length) {
        console.log('❌ Todos os usuários atingiram o limite de hoje.');
        return;
    }
    if (cdIndex >= FILIAIS.length) {
        console.log('✅ Todas as filiais foram processadas com sucesso!');
        return;
    }

    const currentUser = USERS[userIndex];
    const stateFile = `state_${currentUser.email.split('@')[0]}.json`;
    
    console.log(`\n================================================`);
    console.log(`USUÁRIO: ${currentUser.email}`);
    console.log(`FILIAL ATUAL: ${FILIAIS[cdIndex].nome} (${cdIndex + 1}/${FILIAIS.length})`);
    console.log(`================================================\n`);

    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const contextOptions = fs.existsSync(stateFile) ? { storageState: stateFile } : {};
    const context = await browser.newContext({
        ...contextOptions,
        viewport: null,
        acceptDownloads: true
    });

    const page = await context.newPage();

    try {
        console.log('Acessando página de relatórios...');
        await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle' });

        if (page.url().includes('login.xhtml')) {
            console.log('Sessão expirada. Fazendo login...');
            await page.fill('#username', currentUser.email);
            await page.fill('#password', currentUser.pass);
            await page.click('#j_idt9');

            try {
                const errorMsg = page.locator('.ui-messages-error-detail, .ui-growl-item');
                if (await errorMsg.isVisible({ timeout: 5000 })) {
                    console.log(`⚠️ Erro no login: ${await errorMsg.innerText()}`);
                    await browser.close();
                    return run(userIndex + 1, cdIndex);
                }
            } catch (e) {}

            try {
                const popupOk = page.locator('#usuarioLogadoOK');
                await popupOk.waitFor({ state: 'visible', timeout: 5000 });
                await popupOk.click();
            } catch (e) {}

            await page.waitForURL(url => url.toString().includes('private'), { timeout: 30000 });
            await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle' });
            await context.storageState({ path: stateFile });
        } else {
            await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle' });
            await context.storageState({ path: stateFile });
        }

        // --- SELEÇÃO ÚNICA DE RELATÓRIO (Fazer uma vez no início) ---
        console.log('Selecionando Relatório: 14 - Tracking 360...');
        await page.locator('div[id="form:grupo"] .ui-selectonemenu-trigger').click({ delay: 500 });
        await page.waitForTimeout(1500);
        await page.locator('.ui-selectonemenu-panel:visible li').filter({ hasText: /^14 -/ }).click({ delay: 300 });
        await page.waitForTimeout(3000);

        console.log('Selecionando Sub-Relatório: 83 - Entregas...');
        await page.locator('div[id*="relatorio"] .ui-selectonemenu-trigger, .ui-selectonemenu:not(.ui-state-disabled)').last().click({ delay: 500 });
        await page.waitForTimeout(1500);
        await page.locator('.ui-selectonemenu-panel:visible li').filter({ hasText: /^83 -/ }).click({ delay: 300 });
        await page.waitForTimeout(3000);

        // Loop pelas filiais restantes
        for (let i = cdIndex; i < FILIAIS.length; i++) {
            const filial = FILIAIS[i];
            console.log(`\n>>> Processando: ${filial.nome}...`);

            console.log('Abrindo filtros...');
            await page.click('button[id="form:bt_filtro"]', { delay: 500 });
            await page.waitForTimeout(2000);

            // Datas
            const now = new Date();
            const todayDay = String(now.getDate());
            await page.locator('input[id$=":0:data__input"]').click();
            await page.click('.ui-datepicker-calendar:visible a:text-is("1")');
            await page.waitForTimeout(1000);
            await page.locator('input[id$=":1:data__input"]').click();
            await page.click(`.ui-datepicker-calendar:visible a:text-is("${todayDay}")`);
            await page.waitForTimeout(1000);

            // Selecionar Filial
            console.log(`Selecionando CD ${filial.nome}...`);
            await page.locator('label[id$=":2:mq__label"]').click({ force: true });
            await page.waitForTimeout(1000);

            // Desmarcar tudo primeiro
            const allCheckbox = page.locator('.ui-selectcheckboxmenu-panel:visible .ui-selectcheckboxmenu-header .ui-chkbox-box');
            await allCheckbox.click();
            await page.waitForTimeout(500);
            await allCheckbox.click();
            await page.waitForTimeout(500);

            // Agora marca a filial correta
            await page.locator(`.ui-selectcheckboxmenu-items:visible li:has-text("${filial.nome}") .ui-chkbox-box`).click({ force: true });
            await page.waitForTimeout(800);
            await page.keyboard.press('Escape');

            console.log('Consultando...');
            await page.click('.ui-dialog:visible button:has-text("consultar")');

            // Verificação de Limite
            const limitMsg = page.locator('.ui-growl-item:has-text("limite de execução"), .ui-messages:has-text("limite de execução")');
            if (await limitMsg.isVisible({ timeout: 5000 })) {
                console.log(`⚠️ LIMITE ATINGIDO em ${filial.nome}. Trocando usuário...`);
                await browser.close();
                return run(userIndex + 1, i); // Tenta a MESMA filial com o próximo usuário
            }

            console.log('Aguardando carregamento...');
            const loading = page.locator('.ui-dialog:visible:has-text("Carregando...")');
            await loading.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
            await loading.waitFor({ state: 'hidden', timeout: 90000 });
            await page.waitForTimeout(2000);

            console.log('Iniciando download CSV...');
            const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
            await page.click('button[title="Download de Arquivo CSV - separado por \',\'"]', { force: true });
            const download = await downloadPromise;

            // Salvar na pasta correta
            const basePath = path.join(BASE_REPORT_PATH, filial.pasta);
            if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

            const yearYY = String(now.getFullYear()).slice(-2);
            const monthMM = String(now.getMonth() + 1).padStart(2, '0');
            const finalPath = path.join(basePath, `${yearYY}.${monthMM}.csv`);

            if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
            await download.saveAs(finalPath);
            console.log(`✅ ${filial.nome} salvo em: ${finalPath}`);
            
            // Fechar o diálogo de filtros se ele ainda estiver aberto por algum motivo
            try {
                const closeBtn = page.locator('.ui-dialog:visible .ui-dialog-titlebar-close');
                if (await closeBtn.isVisible()) await closeBtn.click();
            } catch (e) {}
        }

        console.log('\n🏁 TODAS AS FILIAIS CONCLUÍDAS!');

    } catch (error) {
        console.error('❌ Erro crítico:', error);
        await page.screenshot({ path: `erro_${FILIAIS[cdIndex].pasta}.png` });
    } finally {
        await browser.close();
        console.log('Navegador fechado.');
    }
}

run();

